import { runGit } from "./exec";

export interface LocalStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  dirtyTracked: number;
  staged: number;
  untracked: number;
  conflicted: number;
  stagedDeletions: number;
  headSha: string | null;
  upstreamSha: string | null;
}

export interface LastCommit {
  sha: string;
  unixTimestamp: number;
  subject: string;
}

export interface RepoSnapshot {
  path: string;
  status: LocalStatus;
  lastCommit: LastCommit | null;
  remoteUrl: string | null;
  weirdFlags: string[];
}

/**
 * Parse `git status --porcelain=v2 --branch`.
 * Spec: https://git-scm.com/docs/git-status#_porcelain_format_version_2
 */
export function parsePorcelainV2(raw: string): LocalStatus {
  const lines = raw.split("\n");
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let detached = false;
  let dirtyTracked = 0;
  let staged = 0;
  let untracked = 0;
  let conflicted = 0;
  let stagedDeletions = 0;
  let headSha: string | null = null;
  let upstreamSha: string | null = null;

  for (const line of lines) {
    if (!line) continue;

    if (line.startsWith("# branch.oid ")) {
      headSha = line.slice("# branch.oid ".length).trim() || null;
    } else if (line.startsWith("# branch.head ")) {
      const v = line.slice("# branch.head ".length).trim();
      if (v === "(detached)") detached = true;
      else branch = v;
    } else if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length).trim();
    } else if (line.startsWith("# branch.ab ")) {
      const rest = line.slice("# branch.ab ".length).trim();
      const match = rest.match(/^\+(\d+) -(\d+)$/);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      // Changed / renamed tracked entry
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const X = xy[0];
      const Y = xy[1];
      if (X && X !== ".") {
        staged++;
        if (X === "D") stagedDeletions++;
      }
      if (Y && Y !== ".") dirtyTracked++;
    } else if (line.startsWith("u ")) {
      conflicted++;
    } else if (line.startsWith("? ")) {
      untracked++;
    }
  }

  return {
    branch,
    upstream,
    ahead,
    behind,
    detached,
    dirtyTracked,
    staged,
    untracked,
    conflicted,
    stagedDeletions,
    headSha,
    upstreamSha,
  };
}

export interface CollectSnapshotOptions {
  path: string;
  timeoutMs?: number;
}

export async function collectSnapshot({ path: repoPath, timeoutMs = 15_000 }: CollectSnapshotOptions): Promise<RepoSnapshot> {
  const [statusRes, logRes, remoteRes] = await Promise.allSettled([
    runGit(["status", "--porcelain=v2", "--branch", "--untracked-files=normal"], {
      cwd: repoPath,
      mode: "read",
      timeoutMs,
    }),
    runGit(["log", "-1", "--format=%H%x00%ct%x00%s"], {
      cwd: repoPath,
      mode: "read",
      timeoutMs,
    }),
    runGit(["config", "--get", "remote.origin.url"], {
      cwd: repoPath,
      mode: "read",
      timeoutMs,
    }),
  ]);

  const status = statusRes.status === "fulfilled"
    ? parsePorcelainV2(statusRes.value.stdout)
    : emptyStatus();

  let lastCommit: LastCommit | null = null;
  if (logRes.status === "fulfilled" && logRes.value.stdout.trim()) {
    const [sha, ts, ...rest] = logRes.value.stdout.trim().split("\x00");
    if (sha && ts) {
      lastCommit = {
        sha,
        unixTimestamp: Number(ts),
        subject: rest.join("\x00"),
      };
    }
  }

  const remoteUrl = remoteRes.status === "fulfilled"
    ? remoteRes.value.stdout.trim() || null
    : null;

  if (status.upstream && status.upstreamSha === null) {
    try {
      const sha = await runGit(["rev-parse", "@{upstream}"], {
        cwd: repoPath,
        mode: "read",
        timeoutMs,
      });
      status.upstreamSha = sha.stdout.trim() || null;
    } catch {
      // no upstream — leave null
    }
  }

  return {
    path: repoPath,
    status,
    lastCommit,
    remoteUrl,
    weirdFlags: [],
  };
}

function emptyStatus(): LocalStatus {
  return {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    dirtyTracked: 0,
    staged: 0,
    untracked: 0,
    conflicted: 0,
    stagedDeletions: 0,
    headSha: null,
    upstreamSha: null,
  };
}
