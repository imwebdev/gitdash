import { runGit } from "./exec";

export interface RecentCommit {
  sha: string;
  subject: string;
  author: string;
  unixTimestamp: number;
}

export interface RepoLogMetadata {
  defaultBranch: string | null;
  totalCommits: number | null;
}

const FIELD_SEP = "\x09";
const RECORD_SEP = "\x1e";

export async function getRecentCommits(
  repoPath: string,
  limit = 10,
  timeoutMs = 10_000,
): Promise<RecentCommit[]> {
  const result = await runGit(
    ["log", "-n", String(limit), `--format=%H${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%at${RECORD_SEP}`],
    { cwd: repoPath, mode: "read", timeoutMs },
  );
  return result.stdout
    .split(RECORD_SEP)
    .map((r) => r.replace(/^\n/, "").trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, author, ts] = record.split(FIELD_SEP);
      return {
        sha: sha ?? "",
        subject: subject ?? "",
        author: author ?? "",
        unixTimestamp: Number(ts ?? 0),
      };
    })
    .filter((c) => c.sha.length > 0);
}

export async function getRepoLogMetadata(
  repoPath: string,
  timeoutMs = 10_000,
): Promise<RepoLogMetadata> {
  let defaultBranch: string | null = null;
  try {
    const head = await runGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
      cwd: repoPath,
      mode: "read",
      timeoutMs,
    });
    const v = head.stdout.trim();
    defaultBranch = v.startsWith("origin/") ? v.slice("origin/".length) : v || null;
  } catch {
    try {
      const cur = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: repoPath,
        mode: "read",
        timeoutMs,
      });
      defaultBranch = cur.stdout.trim() || null;
    } catch {
      defaultBranch = null;
    }
  }

  let totalCommits: number | null = null;
  try {
    const count = await runGit(["rev-list", "--count", "HEAD"], {
      cwd: repoPath,
      mode: "read",
      timeoutMs,
    });
    const n = Number(count.stdout.trim());
    totalCommits = Number.isFinite(n) ? n : null;
  } catch {
    totalCommits = null;
  }

  return { defaultBranch, totalCommits };
}
