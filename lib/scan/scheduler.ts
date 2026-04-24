import pLimit from "p-limit";
import { discoverRepos, detectWeirdFlags, type DiscoveryConfig, parseGithubSlug } from "./discover";
import { collectSnapshot } from "@/lib/git/status";
import { compareWithRemote, fetchCanPush } from "@/lib/gh/client";
import {
  upsertDiscoveredRepo,
  upsertSnapshot,
  updateGithubSlug,
  listActiveRepos,
  markRepoDeleted,
  getRepoById,
} from "@/lib/db/repos";
import { getStore } from "@/lib/state/store";

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
      console.error(`[scheduler] collect failed for ${row.repoPath}`, err);
    }
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
            let canPush: boolean | null = null;
            if (slug && snap.status.headSha && snap.status.branch) {
              [comparison, canPush] = await Promise.all([
                compareWithRemote(slug, snap.status.headSha, snap.status.branch),
                fetchCanPush(slug),
              ]);
            }
            upsertSnapshot(row.id, snap, comparison, weirdFlags, Date.now(), canPush);
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
