import { getDb } from "./schema";
import type { DiscoveredRepo } from "@/lib/scan/discover";
import type { RepoSnapshot } from "@/lib/git/status";
import type { RemoteComparison } from "@/lib/gh/client";
import { parseGithubSlug } from "@/lib/scan/discover";

export interface RepoRow {
  id: number;
  repoPath: string;
  gitDirPath: string;
  isSystemRepo: boolean;
  githubOwner: string | null;
  githubName: string | null;
  discoveredAt: number;
  lastSeenAt: number;
  deletedAt: number | null;
  lastReviewAt: number | null;
  reviewedHeadSha: string | null;
}

interface RepoRaw {
  id: number;
  repo_path: string;
  git_dir_path: string;
  is_system_repo: number;
  github_owner: string | null;
  github_name: string | null;
  discovered_at: number;
  last_seen_at: number;
  deleted_at: number | null;
  last_review_at: number | null;
  reviewed_head_sha: string | null;
}

export interface SnapshotRow {
  repoId: number;
  branch: string | null;
  upstream: string | null;
  headSha: string | null;
  upstreamSha: string | null;
  ahead: number;
  behind: number;
  dirtyTracked: number;
  staged: number;
  stagedDeletions: number;
  untracked: number;
  conflicted: number;
  detached: boolean;
  lastCommitSha: string | null;
  lastCommitTs: number | null;
  lastCommitSubject: string | null;
  remoteUrl: string | null;
  remoteAhead: number | null;
  remoteBehind: number | null;
  remoteState: string | null;
  remoteSha: string | null;
  openPrCount: number;
  weirdFlags: string[];
  collectedAt: number;
  remoteCheckedAt: number | null;
  /**
   * GitHub permission on the remote: true = can push, false = read-only,
   * null = unknown / non-GitHub remote / not yet checked.
   */
  canPush: boolean | null;
}

export function upsertDiscoveredRepo(discovered: DiscoveredRepo, now: number): RepoRow {
  const db = getDb();
  const existing = db.prepare<[string], RepoRaw>("SELECT * FROM repos WHERE repo_path = ?").get(discovered.repoPath);

  if (existing) {
    db.prepare(
      "UPDATE repos SET git_dir_path = ?, is_system_repo = ?, last_seen_at = ?, deleted_at = NULL WHERE id = ?",
    ).run(discovered.gitDirPath, discovered.isSystemRepo ? 1 : 0, now, existing.id);
    return rawToRepoRow({
      ...existing,
      git_dir_path: discovered.gitDirPath,
      is_system_repo: discovered.isSystemRepo ? 1 : 0,
      last_seen_at: now,
      deleted_at: null,
    });
  }

  const result = db.prepare(
    "INSERT INTO repos (repo_path, git_dir_path, is_system_repo, discovered_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
  ).run(discovered.repoPath, discovered.gitDirPath, discovered.isSystemRepo ? 1 : 0, now, now);

  const id = Number(result.lastInsertRowid);
  return {
    id,
    repoPath: discovered.repoPath,
    gitDirPath: discovered.gitDirPath,
    isSystemRepo: discovered.isSystemRepo,
    githubOwner: null,
    githubName: null,
    discoveredAt: now,
    lastSeenAt: now,
    deletedAt: null,
    lastReviewAt: null,
    reviewedHeadSha: null,
  };
}

export function markRepoDeleted(repoId: number, now: number): void {
  getDb().prepare("UPDATE repos SET deleted_at = ? WHERE id = ?").run(now, repoId);
}

export function listActiveRepos(includeSystem: boolean): RepoRow[] {
  const db = getDb();
  const sql = includeSystem
    ? "SELECT * FROM repos WHERE deleted_at IS NULL ORDER BY repo_path"
    : "SELECT * FROM repos WHERE deleted_at IS NULL AND is_system_repo = 0 ORDER BY repo_path";
  return db.prepare<[], RepoRaw>(sql).all().map(rawToRepoRow);
}

export function getRepoById(id: number): RepoRow | null {
  const row = getDb().prepare<[number], RepoRaw>("SELECT * FROM repos WHERE id = ?").get(id);
  return row ? rawToRepoRow(row) : null;
}

export function updateGithubSlug(repoId: number, remoteUrl: string | null): void {
  const slug = parseGithubSlug(remoteUrl);
  getDb().prepare(
    "UPDATE repos SET github_owner = ?, github_name = ? WHERE id = ?",
  ).run(slug?.owner ?? null, slug?.name ?? null, repoId);
}

export function upsertSnapshot(
  repoId: number,
  snap: RepoSnapshot,
  remote: RemoteComparison | null,
  weirdFlags: string[],
  now: number,
  openPrCount: number | null = null,
  canPush: boolean | null = null,
): void {
  getDb().prepare(
    `INSERT INTO snapshots (
      repo_id, branch, upstream, head_sha, upstream_sha,
      ahead, behind, dirty_tracked, staged, staged_deletions,
      untracked, conflicted, detached, last_commit_sha, last_commit_ts,
      last_commit_subject, remote_url, remote_ahead, remote_behind,
      remote_state, remote_sha, open_pr_count, weird_flags, collected_at, remote_checked_at,
      can_push
    ) VALUES (
      @repo_id, @branch, @upstream, @head_sha, @upstream_sha,
      @ahead, @behind, @dirty_tracked, @staged, @staged_deletions,
      @untracked, @conflicted, @detached, @last_commit_sha, @last_commit_ts,
      @last_commit_subject, @remote_url, @remote_ahead, @remote_behind,
      @remote_state, @remote_sha, @open_pr_count, @weird_flags, @collected_at, @remote_checked_at,
      @can_push
    )
    ON CONFLICT(repo_id) DO UPDATE SET
      branch = excluded.branch,
      upstream = excluded.upstream,
      head_sha = excluded.head_sha,
      upstream_sha = excluded.upstream_sha,
      ahead = excluded.ahead,
      behind = excluded.behind,
      dirty_tracked = excluded.dirty_tracked,
      staged = excluded.staged,
      staged_deletions = excluded.staged_deletions,
      untracked = excluded.untracked,
      conflicted = excluded.conflicted,
      detached = excluded.detached,
      last_commit_sha = excluded.last_commit_sha,
      last_commit_ts = excluded.last_commit_ts,
      last_commit_subject = excluded.last_commit_subject,
      remote_url = excluded.remote_url,
      remote_ahead = COALESCE(excluded.remote_ahead, remote_ahead),
      remote_behind = COALESCE(excluded.remote_behind, remote_behind),
      remote_state = COALESCE(excluded.remote_state, remote_state),
      remote_sha = COALESCE(excluded.remote_sha, remote_sha),
      open_pr_count = COALESCE(excluded.open_pr_count, open_pr_count),
      weird_flags = excluded.weird_flags,
      collected_at = excluded.collected_at,
      remote_checked_at = COALESCE(excluded.remote_checked_at, remote_checked_at),
      can_push = COALESCE(excluded.can_push, can_push)`,
  ).run({
    repo_id: repoId,
    branch: snap.status.branch,
    upstream: snap.status.upstream,
    head_sha: snap.status.headSha,
    upstream_sha: snap.status.upstreamSha,
    ahead: snap.status.ahead,
    behind: snap.status.behind,
    dirty_tracked: snap.status.dirtyTracked,
    staged: snap.status.staged,
    staged_deletions: snap.status.stagedDeletions,
    untracked: snap.status.untracked,
    conflicted: snap.status.conflicted,
    detached: snap.status.detached ? 1 : 0,
    last_commit_sha: snap.lastCommit?.sha ?? null,
    last_commit_ts: snap.lastCommit?.unixTimestamp ?? null,
    last_commit_subject: snap.lastCommit?.subject ?? null,
    remote_url: snap.remoteUrl,
    remote_ahead: remote?.ahead ?? null,
    remote_behind: remote?.behind ?? null,
    remote_state: remote?.state ?? null,
    remote_sha: remote?.remoteSha ?? null,
    open_pr_count: openPrCount,
    weird_flags: JSON.stringify(weirdFlags),
    collected_at: now,
    remote_checked_at: remote ? now : null,
    can_push: canPush === null ? null : canPush ? 1 : 0,
  });
}

interface SnapshotRaw {
  repo_id: number;
  branch: string | null;
  upstream: string | null;
  head_sha: string | null;
  upstream_sha: string | null;
  ahead: number;
  behind: number;
  dirty_tracked: number;
  staged: number;
  staged_deletions: number;
  untracked: number;
  conflicted: number;
  detached: number;
  last_commit_sha: string | null;
  last_commit_ts: number | null;
  last_commit_subject: string | null;
  remote_url: string | null;
  remote_ahead: number | null;
  remote_behind: number | null;
  remote_state: string | null;
  remote_sha: string | null;
  open_pr_count: number;
  weird_flags: string;
  collected_at: number;
  remote_checked_at: number | null;
  can_push: number | null;
}

export function getSnapshot(repoId: number): SnapshotRow | null {
  const row = getDb().prepare<[number], SnapshotRaw>("SELECT * FROM snapshots WHERE repo_id = ?").get(repoId);
  return row ? rawToSnapshot(row) : null;
}

export function getAllSnapshots(): Map<number, SnapshotRow> {
  const rows = getDb().prepare<[], SnapshotRaw>("SELECT * FROM snapshots").all();
  return new Map(rows.map((r) => [r.repo_id, rawToSnapshot(r)]));
}

export interface ActionLogRow {
  id: number;
  action: string;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
}

interface ActionLogRaw {
  id: number;
  action: string;
  started_at: number;
  finished_at: number | null;
  exit_code: number | null;
}

export function getRecentActions(repoId: number, limit = 5): ActionLogRow[] {
  const rows = getDb()
    .prepare<[number, number], ActionLogRaw>(
      "SELECT id, action, started_at, finished_at, exit_code FROM actions_log WHERE repo_id = ? ORDER BY started_at DESC LIMIT ?",
    )
    .all(repoId, limit);
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    exitCode: r.exit_code,
  }));
}

function rawToRepoRow(r: RepoRaw): RepoRow {
  return {
    id: r.id,
    repoPath: r.repo_path,
    gitDirPath: r.git_dir_path,
    isSystemRepo: r.is_system_repo === 1,
    githubOwner: r.github_owner,
    githubName: r.github_name,
    discoveredAt: r.discovered_at,
    lastSeenAt: r.last_seen_at,
    deletedAt: r.deleted_at,
    lastReviewAt: r.last_review_at ?? null,
    reviewedHeadSha: r.reviewed_head_sha ?? null,
  };
}

export function getRepoByPath(repoPath: string): RepoRow | null {
  const row = getDb()
    .prepare<[string], RepoRaw>("SELECT * FROM repos WHERE repo_path = ? AND deleted_at IS NULL")
    .get(repoPath);
  return row ? rawToRepoRow(row) : null;
}

export function markRepoReviewed(repoId: number, headSha: string, now: number): void {
  getDb()
    .prepare("UPDATE repos SET last_review_at = ?, reviewed_head_sha = ? WHERE id = ?")
    .run(now, headSha, repoId);
}

function rawToSnapshot(r: SnapshotRaw): SnapshotRow {
  let weirdFlags: string[] = [];
  try {
    weirdFlags = JSON.parse(r.weird_flags);
  } catch {
    weirdFlags = [];
  }
  return {
    repoId: r.repo_id,
    branch: r.branch,
    upstream: r.upstream,
    headSha: r.head_sha,
    upstreamSha: r.upstream_sha,
    ahead: r.ahead,
    behind: r.behind,
    dirtyTracked: r.dirty_tracked,
    staged: r.staged,
    stagedDeletions: r.staged_deletions,
    untracked: r.untracked,
    conflicted: r.conflicted,
    detached: r.detached === 1,
    lastCommitSha: r.last_commit_sha,
    lastCommitTs: r.last_commit_ts,
    lastCommitSubject: r.last_commit_subject,
    remoteUrl: r.remote_url,
    remoteAhead: r.remote_ahead,
    remoteBehind: r.remote_behind,
    remoteState: r.remote_state,
    remoteSha: r.remote_sha,
    openPrCount: r.open_pr_count,
    weirdFlags,
    collectedAt: r.collected_at,
    remoteCheckedAt: r.remote_checked_at,
    canPush:
      r.can_push === null || r.can_push === undefined
        ? null
        : r.can_push === 1,
  };
}
