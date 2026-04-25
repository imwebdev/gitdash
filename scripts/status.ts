/**
 * scripts/status.ts
 *
 * Prints a one-line git status summary for the repo at --cwd (default $PWD).
 * Optionally prints a second line nudging for a security review when
 * unreviewed commits accumulate past configured thresholds.
 * Reads SQLite directly — no server needed.
 *
 * Usage:  tsx scripts/status.ts [--cwd <path>]
 * Called by:  bin/gitdash status [--cwd <path>]
 *
 * Exits 0 always. Prints nothing for untracked dirs or DB errors.
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";

// ── CLI arg parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let inputDir = process.env.PWD ?? process.cwd();

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--cwd" && args[i + 1]) {
    inputDir = args[i + 1]!;
    break;
  }
}

// ── Resolve git root ─────────────────────────────────────────────────────────

function findGitRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 50; i++) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
  return null;
}

const gitRoot = findGitRoot(inputDir);
if (!gitRoot) process.exit(0);

// ── Open DB read-only ────────────────────────────────────────────────────────

const DB_PATH =
  process.env.GITDASH_DB ??
  path.join(
    process.env.HOME ?? ".",
    ".local",
    "state",
    "gitdash",
    "gitdash.sqlite",
  );

if (!existsSync(DB_PATH)) process.exit(0);

// ── Load reviewSuggest config ────────────────────────────────────────────────

interface ReviewSuggestConfig {
  enabled: boolean;
  commitThreshold: number;
  daysCadence: number;
}

function loadReviewConfig(): ReviewSuggestConfig {
  const defaults: ReviewSuggestConfig = {
    enabled: true,
    commitThreshold: 5,
    daysCadence: 7,
  };
  try {
    const configPath = path.join(
      process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? ".", ".config"),
      "gitdash",
      "config.json",
    );
    if (!existsSync(configPath)) return defaults;
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const rs = raw["reviewSuggest"] as Record<string, unknown> | undefined;
    if (!rs) return defaults;
    return {
      enabled: typeof rs["enabled"] === "boolean" ? rs["enabled"] : defaults.enabled,
      commitThreshold:
        typeof rs["commitThreshold"] === "number" ? rs["commitThreshold"] : defaults.commitThreshold,
      daysCadence:
        typeof rs["daysCadence"] === "number" ? rs["daysCadence"] : defaults.daysCadence,
    };
  } catch {
    return defaults;
  }
}

// ── execFile helper (no shell, matches security model) ───────────────────────

function gitRevListCount(repoPath: string, range: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repoPath, "rev-list", "--count", range],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) { resolve(0); return; }
        const n = parseInt(stdout.trim(), 10);
        resolve(isNaN(n) ? 0 : n);
      },
    );
  });
}

function gitRevParse(repoPath: string, ref: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repoPath, "rev-parse", "--verify", ref],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) { resolve(null); return; }
        const sha = stdout.trim();
        resolve(sha || null);
      },
    );
  });
}

try {
  const db = new Database(DB_PATH, { readonly: true });

  // ── Lookup repo ────────────────────────────────────────────────────────────

  interface RepoRaw {
    id: number;
    is_system_repo: number;
    github_owner: string | null;
    github_name: string | null;
    last_review_at: number | null;
    reviewed_head_sha: string | null;
  }
  const repo = db
    .prepare<[string], RepoRaw>(
      "SELECT id, is_system_repo, github_owner, github_name, last_review_at, reviewed_head_sha FROM repos WHERE repo_path = ? AND deleted_at IS NULL",
    )
    .get(gitRoot);

  if (!repo) process.exit(0);

  // ── Load snapshot ──────────────────────────────────────────────────────────

  interface SnapRaw {
    branch: string | null;
    upstream: string | null;
    ahead: number;
    behind: number;
    dirty_tracked: number;
    staged: number;
    staged_deletions: number;
    untracked: number;
    conflicted: number;
    detached: number;
    remote_state: string | null;
    remote_ahead: number | null;
    remote_behind: number | null;
    weird_flags: string;
    can_push: number | null;
  }
  const snap = db
    .prepare<[number], SnapRaw>(
      `SELECT branch, upstream, ahead, behind, dirty_tracked, staged,
              staged_deletions, untracked, conflicted, detached,
              remote_state, remote_ahead, remote_behind,
              weird_flags, can_push
       FROM snapshots WHERE repo_id = ?`,
    )
    .get(repo.id);

  if (!snap) process.exit(0);

  // ── Derive state (mirrors lib/state/store.ts::deriveState) ────────────────

  let weirdFlags: string[] = [];
  try { weirdFlags = JSON.parse(snap.weird_flags); } catch { weirdFlags = []; }

  const detached = snap.detached === 1;
  const dirty = snap.dirty_tracked + snap.staged + snap.untracked + snap.conflicted;
  const canPush = snap.can_push === null ? null : snap.can_push === 1;

  type State = "clean" | "ahead" | "behind" | "diverged" | "dirty" | "read-only" | "no-upstream" | "weird" | "unknown";
  let state: State;

  if (weirdFlags.length > 0 || detached || snap.staged_deletions > 500 || dirty > 1000) {
    state = "weird";
  } else if (canPush === false) {
    state = "read-only";
  } else if (dirty > 0) {
    state = "dirty";
  } else if (snap.remote_state === "diverged") {
    state = "diverged";
  } else if (snap.remote_state === "ahead" || snap.ahead > 0) {
    state = "ahead";
  } else if (snap.remote_state === "behind" || snap.behind > 0) {
    state = "behind";
  } else if (!snap.upstream && !snap.remote_state) {
    state = "no-upstream";
  } else if (snap.remote_state === "unknown") {
    state = "unknown";
  } else {
    state = "clean";
  }

  // ── Format output ──────────────────────────────────────────────────────────

  const branch = snap.branch ?? "HEAD";
  const ahead = snap.remote_ahead ?? snap.ahead;
  const behind = snap.remote_behind ?? snap.behind;

  const lines: Record<State, string> = {
    clean:        `✓ gitdash: in sync · ${branch}`,
    ahead:        `↑ gitdash: ${ahead} ahead · ${branch}`,
    behind:       `↓ gitdash: ${behind} behind · ${branch}`,
    diverged:     `⇅ gitdash: ${ahead} ahead, ${behind} behind · ${branch}`,
    dirty:        `✗ gitdash: ${dirty} uncommitted change(s) · ${branch}`,
    "read-only":  `✓ gitdash: read-only · ${branch}`,
    "no-upstream":`ⓘ gitdash: local-only · ${branch}`,
    weird:        `⚠ gitdash: needs attention · ${branch}`,
    unknown:      `ⓘ gitdash: remote check pending · ${branch}`,
  };

  process.stdout.write(lines[state] + "\n");

  // ── Review nudge ───────────────────────────────────────────────────────────

  const reviewConfig = loadReviewConfig();
  const lastReviewAt: number | null = repo.last_review_at ?? null;
  const reviewedHeadSha: string | null = repo.reviewed_head_sha ?? null;

  db.close();

  if (reviewConfig.enabled) {
    // Async git calls — run and always exit 0 when done
    (async () => {
      try {
        // Compute commitsSinceReview
        let commitsSinceReview: number;

        if (reviewedHeadSha) {
          // Check if the reviewed SHA is still reachable
          const resolved = await gitRevParse(gitRoot, reviewedHeadSha);
          if (resolved) {
            // Count commits from reviewed sha to HEAD
            commitsSinceReview = await gitRevListCount(gitRoot, `${reviewedHeadSha}..HEAD`);
          } else {
            // SHA no longer reachable (force-push / rebase) — count from total
            commitsSinceReview = await gitRevListCount(gitRoot, "HEAD");
          }
        } else {
          // Never reviewed — count all commits
          commitsSinceReview = await gitRevListCount(gitRoot, "HEAD");
        }

        // Compute daysSinceReview.
        // Only apply the time cadence when a baseline review exists.
        // When lastReviewAt is null the repo has never been reviewed — the
        // time trigger does not apply (only the commit threshold does).
        const daysSinceReview =
          lastReviewAt === null
            ? null
            : (Date.now() - lastReviewAt) / 86_400_000;

        // Edge case: brand-new repo with 0–2 commits, never reviewed → skip nudge
        const commitThresholdMet = commitsSinceReview >= reviewConfig.commitThreshold;
        const timeThresholdMet =
          daysSinceReview !== null && daysSinceReview >= reviewConfig.daysCadence;

        const isNewAndUnreviewed = reviewedHeadSha === null && commitsSinceReview <= 2;
        const shouldNudge = !isNewAndUnreviewed && (commitThresholdMet || timeThresholdMet);

        if (shouldNudge) {
          process.stdout.write(
            `   → ${commitsSinceReview} commit(s) since last review · run /security-review to scan\n`,
          );
        }
      } catch {
        // Stay silent on any error
      }
    })().finally(() => process.exit(0));
  } else {
    process.exit(0);
  }
} catch {
  // DB locked, corrupt, or missing table — stay silent
  process.exit(0);
}
