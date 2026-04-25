import { existsSync } from "node:fs";
import pLimit from "p-limit";
import { discoverRepos, detectWeirdFlags, type DiscoveryConfig, parseGithubSlug } from "./discover";
import { collectSnapshot } from "@/lib/git/status";
import { compareWithRemote, fetchOpenPrCount, fetchCanPush, type RemoteState } from "@/lib/gh/client";
import {
  upsertDiscoveredRepo,
  upsertSnapshot,
  updateGithubSlug,
  listActiveRepos,
  markRepoDeleted,
  getRepoById,
} from "@/lib/db/repos";
import { getStore } from "@/lib/state/store";
import { getDb } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// In-memory rate limiter for refreshRemoteOne — module-level Map is adequate
// for a single-process gitdash and survives Next.js HMR fine.
// ---------------------------------------------------------------------------
const refreshTimestamps = new Map<number, number>();
const MIN_REFRESH_INTERVAL_MS = 5_000;

export function rateLimitCheck(repoId: number): { allowed: boolean; retryAfterMs: number } {
  const last = refreshTimestamps.get(repoId) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < MIN_REFRESH_INTERVAL_MS) {
    return { allowed: false, retryAfterMs: MIN_REFRESH_INTERVAL_MS - elapsed };
  }
  return { allowed: true, retryAfterMs: 0 };
}

export function recordRefreshTimestamp(repoId: number): void {
  refreshTimestamps.set(repoId, Date.now());
}

export type RefreshRemoteResult = {
  state: RemoteState | "no-github" | "no-snapshot";
  ahead: number;
  behind: number;
  remoteSha: string | null;
  checkedAt: number;
};

export interface SchedulerOptions {
  config: DiscoveryConfig;
  rescanIntervalMs?: number;
  remoteIntervalMs?: number;
  localConcurrency?: number;
  remoteConcurrency?: number;
}

const DEFAULT_RESCAN_INTERVAL = 10 * 60 * 1000;
const DEFAULT_REMOTE_INTERVAL = 60 * 1000;

class Scheduler {
  private config: DiscoveryConfig;
  private rescanIntervalMs: number;
  private remoteIntervalMs: number;
  private localLimit: ReturnType<typeof pLimit>;
  private remoteLimit: ReturnType<typeof pLimit>;
  private rescanTimer: NodeJS.Timeout | null = null;
  private remoteTimer: NodeJS.Timeout | null = null;
  private started = false;
  private remoteCursor = 0;

  constructor(opts: SchedulerOptions) {
    this.config = opts.config;
    this.rescanIntervalMs = opts.rescanIntervalMs ?? DEFAULT_RESCAN_INTERVAL;
    this.remoteIntervalMs = opts.remoteIntervalMs ?? DEFAULT_REMOTE_INTERVAL;
    this.localLimit = pLimit(opts.localConcurrency ?? 8);
    this.remoteLimit = pLimit(opts.remoteConcurrency ?? 4);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.runDiscovery();
    await this.collectAllLocal();
    this.rescanTimer = setInterval(() => {
      this.runDiscovery().catch((e) => console.error("[scheduler] discovery failed", e));
    }, this.rescanIntervalMs);
    this.remoteTimer = setInterval(() => {
      this.tickRemote().catch((e) => console.error("[scheduler] remote tick failed", e));
    }, Math.max(5000, Math.floor(this.remoteIntervalMs / 4)));
  }

  stop(): void {
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    if (this.remoteTimer) clearInterval(this.remoteTimer);
    this.rescanTimer = null;
    this.remoteTimer = null;
    this.started = false;
  }

  async runDiscovery(): Promise<void> {
    const now = Date.now();
    const discovered = await discoverRepos(this.config);
    const seenIds = new Set<number>();
    for (const d of discovered) {
      const row = upsertDiscoveredRepo(d, now);
      seenIds.add(row.id);
    }
    // Mark stale repos as deleted
    const active = listActiveRepos(true);
    for (const row of active) {
      if (!seenIds.has(row.id)) {
        markRepoDeleted(row.id, now);
      }
    }
    getStore().emitBulk();
  }

  async collectOne(repoId: number): Promise<void> {
    const row = getRepoById(repoId);
    if (!row || row.deletedAt !== null) return;
    const now = Date.now();
    try {
      const snap = await collectSnapshot({ path: row.repoPath });
      const weirdFlags = await detectWeirdFlags(row.repoPath);
      if (snap.remoteUrl && !row.githubOwner) {
        updateGithubSlug(row.id, snap.remoteUrl);
      }
      upsertSnapshot(row.id, snap, null, weirdFlags, now);
      getStore().emitUpdate(row.id);
    } catch (err) {
      if (!existsSync(row.repoPath) || !existsSync(row.gitDirPath)) {
        markRepoDeleted(row.id, now);
        getStore().emitBulk();
        return;
      }
      console.error(`[scheduler] collect failed for ${row.repoPath}`, err);
    }
  }

  /**
   * Force-refresh the remote state for a single repo, bypassing the normal
   * round-robin cadence. Cache entries for this repo's slug are invalidated
   * first so we get a fresh API call rather than a 304 hit.
   */
  async refreshRemoteOne(repoId: number): Promise<RefreshRemoteResult> {
    const now = Date.now();
    const row = getRepoById(repoId);
    if (!row || row.deletedAt !== null) {
      return { state: "no-github", ahead: 0, behind: 0, remoteSha: null, checkedAt: now };
    }

    // Collect current local state first.
    let snap;
    let weirdFlags: string[] = [];
    try {
      snap = await collectSnapshot({ path: row.repoPath });
      weirdFlags = await detectWeirdFlags(row.repoPath);
      if (snap.remoteUrl && !row.githubOwner) {
        updateGithubSlug(row.id, snap.remoteUrl);
      }
      upsertSnapshot(row.id, snap, null, weirdFlags, now);
    } catch {
      return { state: "no-snapshot", ahead: 0, behind: 0, remoteSha: null, checkedAt: now };
    }

    const slug = parseGithubSlug(snap.remoteUrl);
    if (!slug) {
      return { state: "no-github", ahead: 0, behind: 0, remoteSha: null, checkedAt: now };
    }
    if (!snap.status.headSha || !snap.status.branch) {
      return { state: "no-snapshot", ahead: 0, behind: 0, remoteSha: null, checkedAt: now };
    }

    // Invalidate ETag cache rows for this slug so we bypass 304 caching.
    const likeCommits = `commits:${slug.owner}/${slug.name}:%`;
    const likeCompare = `compare:${slug.owner}/${slug.name}:%`;
    getDb().prepare("DELETE FROM gh_etag_cache WHERE key LIKE ?").run(likeCommits);
    getDb().prepare("DELETE FROM gh_etag_cache WHERE key LIKE ?").run(likeCompare);

    // Run remote checks in parallel; errors are swallowed by each helper.
    const [comparison, prCount, canPush] = await Promise.all([
      compareWithRemote(slug, snap.status.headSha, snap.status.branch),
      fetchOpenPrCount(slug),
      fetchCanPush(slug),
    ]);

    upsertSnapshot(row.id, snap, comparison, weirdFlags, Date.now(), prCount, canPush);
    getStore().emitUpdate(repoId);

    return {
      state: comparison.state,
      ahead: comparison.ahead,
      behind: comparison.behind,
      remoteSha: comparison.remoteSha,
      checkedAt: comparison.checkedAt,
    };
  }

  async collectAllLocal(): Promise<void> {
    const active = listActiveRepos(true);
    await Promise.all(
      active.map((row) => this.localLimit(() => this.collectOne(row.id))),
    );
  }

  /**
   * Check remote for a small batch of repos per tick. Staggered round-robin
   * so each repo gets checked roughly every remoteIntervalMs.
   */
  private async tickRemote(): Promise<void> {
    const active = listActiveRepos(true).filter((r) => r.githubOwner && r.githubName);
    if (active.length === 0) return;
    const batchSize = Math.max(1, Math.ceil(active.length / (this.remoteIntervalMs / 5000)));
    const slice = [];
    for (let i = 0; i < batchSize && i < active.length; i++) {
      slice.push(active[(this.remoteCursor + i) % active.length]!);
    }
    this.remoteCursor = (this.remoteCursor + batchSize) % active.length;

    await Promise.all(
      slice.map((row) =>
        this.remoteLimit(async () => {
          try {
            const snap = await collectSnapshot({ path: row.repoPath });
            const weirdFlags = await detectWeirdFlags(row.repoPath);
            const slug = parseGithubSlug(snap.remoteUrl);
            let comparison = null;
            let prCount: number | null = null;
            let canPush: boolean | null = null;
            if (slug && snap.status.headSha && snap.status.branch) {
              [comparison, prCount, canPush] = await Promise.all([
                compareWithRemote(slug, snap.status.headSha, snap.status.branch),
                fetchOpenPrCount(slug),
                fetchCanPush(slug),
              ]);
            }
            upsertSnapshot(row.id, snap, comparison, weirdFlags, Date.now(), prCount, canPush);
            getStore().emitUpdate(row.id);
          } catch (err) {
            console.error(`[scheduler] remote tick failed for ${row.repoPath}`, err);
          }
        }),
      ),
    );
  }
}

const globalKey = Symbol.for("gitdash.scheduler");
type GlobalWithScheduler = typeof globalThis & { [globalKey]?: Scheduler };
const g = globalThis as GlobalWithScheduler;

export async function ensureSchedulerStarted(opts: SchedulerOptions): Promise<Scheduler> {
  if (!g[globalKey]) {
    g[globalKey] = new Scheduler(opts);
    await g[globalKey]!.start();
  }
  return g[globalKey]!;
}

export function getScheduler(): Scheduler | null {
  return g[globalKey] ?? null;
}
