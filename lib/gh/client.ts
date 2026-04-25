import { runGh } from "@/lib/git/exec";
import { getDb } from "@/lib/db/schema";
import type { GitHubSlug } from "@/lib/scan/discover";

export type RemoteState =
  | "clean"
  | "ahead"
  | "behind"
  | "diverged"
  | "no-upstream"
  | "unknown"
  // Repo itself is missing on GitHub (deleted, renamed, or made private and
  // we can't see it). User has to update or remove the remote.
  | "gone"
  // Repo exists on GitHub but the local branch isn't on it yet. Click Push
  // and gitdash will publish the branch with --set-upstream.
  | "unpushed-branch";

export interface RemoteComparison {
  state: RemoteState;
  ahead: number;
  behind: number;
  remoteSha: string | null;
  localSha: string | null;
  checkedAt: number;
}

interface EtagRow {
  etag: string;
  body_json: string;
  fetched_at: number;
}

function cacheKey(slug: GitHubSlug, branch: string): string {
  return `commits:${slug.owner}/${slug.name}:${branch}`;
}

function readCache(key: string): EtagRow | null {
  return (
    getDb()
      .prepare<[string], EtagRow>("SELECT etag, body_json, fetched_at FROM gh_etag_cache WHERE key = ?")
      .get(key) ?? null
  );
}

function writeCache(key: string, etag: string, body: string, now: number): void {
  getDb()
    .prepare(
      "INSERT INTO gh_etag_cache (key, etag, body_json, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET etag = excluded.etag, body_json = excluded.body_json, fetched_at = excluded.fetched_at",
    )
    .run(key, etag, body, now);
}

/**
 * Fetch remote tip SHA for a branch using `gh api` with ETag caching.
 * Returns null on auth/404/422 — logs to stderr. Rate-limit-aware via 304 caching.
 */
async function fetchRemoteSha(slug: GitHubSlug, branch: string): Promise<{ sha: string; fromCache: boolean } | null> {
  const key = cacheKey(slug, branch);
  const cached = readCache(key);

  const args = [
    "api",
    "--method",
    "GET",
    "--include",
    `repos/${slug.owner}/${slug.name}/commits/${encodeURIComponent(branch)}`,
  ];
  if (cached) {
    args.push("-H", `If-None-Match: ${cached.etag}`);
  }

  let stdout: string;
  try {
    const res = await runGh(args, { timeoutMs: 15_000 });
    stdout = res.stdout;
  } catch (err) {
    const e = err as { stderr?: string };
    const stderr = e.stderr ?? "";
    // gh CLI exits 1 on 304 even though it's a successful cache hit.
    if (/\b304\b/.test(stderr) && cached) {
      try {
        const parsed = JSON.parse(cached.body_json) as { sha?: string };
        if (parsed.sha) return { sha: parsed.sha, fromCache: true };
      } catch {
        return null;
      }
      return null;
    }
    if (/404/.test(stderr)) return null;
    if (/403/.test(stderr) && cached) {
      try {
        const parsed = JSON.parse(cached.body_json) as { sha?: string };
        if (parsed.sha) return { sha: parsed.sha, fromCache: true };
      } catch {
        // fall through
      }
    }
    return null;
  }

  const { statusCode, etag, body } = parseIncludedResponse(stdout);
  if (statusCode === 304 && cached) {
    try {
      const parsed = JSON.parse(cached.body_json) as { sha?: string };
      if (parsed.sha) return { sha: parsed.sha, fromCache: true };
    } catch {
      return null;
    }
    return null;
  }
  if (statusCode >= 200 && statusCode < 300) {
    try {
      const parsed = JSON.parse(body) as { sha?: string };
      if (!parsed.sha) return null;
      if (etag) writeCache(key, etag, body, Date.now());
      return { sha: parsed.sha, fromCache: false };
    } catch {
      return null;
    }
  }
  return null;
}

function parseIncludedResponse(raw: string): { statusCode: number; etag: string | null; body: string } {
  // `gh api --include` prefixes the response with HTTP headers, blank line, then body.
  const split = raw.indexOf("\r\n\r\n");
  const headerEnd = split >= 0 ? split : raw.indexOf("\n\n");
  if (headerEnd < 0) {
    return { statusCode: 200, etag: null, body: raw };
  }
  const headerBlock = raw.slice(0, headerEnd);
  const body = raw.slice(headerEnd).replace(/^(?:\r\n){2}|^\n\n/, "");
  const lines = headerBlock.split(/\r?\n/);
  const statusLine = lines[0] ?? "";
  const statusMatch = statusLine.match(/^HTTP\/\S+\s+(\d+)/);
  const statusCode = statusMatch ? Number(statusMatch[1]) : 200;
  let etag: string | null = null;
  for (const line of lines.slice(1)) {
    const m = line.match(/^etag:\s*(.+)$/i);
    if (m && m[1]) {
      etag = m[1].trim();
      break;
    }
  }
  return { statusCode, etag, body };
}

interface RepoMeta {
  exists: boolean;
  defaultBranch: string | null;
}

/**
 * One-shot probe for repo existence + default branch. Used as a fallback
 * when the per-branch SHA fetch comes back empty so we can disambiguate
 * "branch isn't on remote yet" from "the whole repo is gone."
 */
async function fetchRepoMeta(slug: GitHubSlug): Promise<RepoMeta> {
  try {
    const res = await runGh([
      "api",
      "--method",
      "GET",
      `repos/${slug.owner}/${slug.name}`,
    ], { timeoutMs: 15_000 });
    const parsed = JSON.parse(res.stdout) as { default_branch?: string };
    return { exists: true, defaultBranch: parsed.default_branch ?? null };
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (/\b404\b/.test(stderr)) return { exists: false, defaultBranch: null };
    // 401/403/network — be conservative, assume the repo is fine and we just
    // had an auth/transport blip.
    return { exists: true, defaultBranch: null };
  }
}

/**
 * Use the GitHub compare endpoint to get ahead/behind directly.
 * Falls back gracefully on auth errors.
 */
export async function compareWithRemote(
  slug: GitHubSlug,
  localSha: string,
  branch: string,
): Promise<RemoteComparison> {
  const now = Date.now();
  const remote = await fetchRemoteSha(slug, branch);
  if (!remote) {
    // SHA fetch failed — could be the branch isn't on GitHub yet, or the
    // repo is gone, or auth blip. Probe repo metadata to disambiguate.
    const meta = await fetchRepoMeta(slug);
    if (!meta.exists) {
      return { state: "gone", ahead: 0, behind: 0, remoteSha: null, localSha, checkedAt: now };
    }
    if (meta.defaultBranch && meta.defaultBranch !== branch) {
      // Repo exists. Try the default branch — if THAT works, only the
      // local branch is missing on remote (unpushed). If even the default
      // 404s, treat it as ambiguous (unknown).
      const defaultRemote = await fetchRemoteSha(slug, meta.defaultBranch);
      if (defaultRemote) {
        return {
          state: "unpushed-branch",
          ahead: 0,
          behind: 0,
          remoteSha: null,
          localSha,
          checkedAt: now,
        };
      }
    }
    return { state: "unknown", ahead: 0, behind: 0, remoteSha: null, localSha, checkedAt: now };
  }
  if (remote.sha === localSha) {
    return { state: "clean", ahead: 0, behind: 0, remoteSha: remote.sha, localSha, checkedAt: now };
  }

  // Compare local..remote via gh api
  const compareKey = `compare:${slug.owner}/${slug.name}:${localSha}...${remote.sha}`;
  const cachedCmp = readCache(compareKey);
  const args = [
    "api",
    "--method",
    "GET",
    "--include",
    `repos/${slug.owner}/${slug.name}/compare/${localSha}...${remote.sha}`,
  ];
  if (cachedCmp) args.push("-H", `If-None-Match: ${cachedCmp.etag}`);

  try {
    const res = await runGh(args, { timeoutMs: 15_000 });
    const parsed = parseIncludedResponse(res.stdout);
    if (parsed.statusCode === 304 && cachedCmp) {
      const body = JSON.parse(cachedCmp.body_json) as {
        ahead_by?: number;
        behind_by?: number;
        status?: string;
      };
      return comparisonFromBody(body, remote.sha, localSha, now);
    }
    if (parsed.statusCode >= 200 && parsed.statusCode < 300) {
      const body = JSON.parse(parsed.body) as {
        ahead_by?: number;
        behind_by?: number;
        status?: string;
      };
      if (parsed.etag) writeCache(compareKey, parsed.etag, parsed.body, now);
      return comparisonFromBody(body, remote.sha, localSha, now);
    }
  } catch (err) {
    // gh CLI exits 1 on 304 even though it's a successful cache hit.
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (/\b304\b/.test(stderr) && cachedCmp) {
      try {
        const body = JSON.parse(cachedCmp.body_json) as {
          ahead_by?: number;
          behind_by?: number;
          status?: string;
        };
        return comparisonFromBody(body, remote.sha, localSha, now);
      } catch {
        // fall through
      }
    }
  }
  return { state: "unknown", ahead: 0, behind: 0, remoteSha: remote.sha, localSha, checkedAt: now };
}

function comparisonFromBody(
  body: { ahead_by?: number; behind_by?: number; status?: string },
  remoteSha: string,
  localSha: string,
  now: number,
): RemoteComparison {
  const ahead = body.ahead_by ?? 0;
  const behind = body.behind_by ?? 0;
  let state: RemoteState;
  if (body.status === "identical" || (ahead === 0 && behind === 0)) state = "clean";
  else if (body.status === "ahead" || (ahead > 0 && behind === 0)) state = "ahead";
  else if (body.status === "behind" || (ahead === 0 && behind > 0)) state = "behind";
  else state = "diverged";
  return { state, ahead, behind, remoteSha, localSha, checkedAt: now };
}

export async function fetchOpenPrCount(slug: GitHubSlug): Promise<number | null> {
  try {
    const res = await runGh([
      "api",
      "--method",
      "GET",
      `search/issues?q=${encodeURIComponent(`repo:${slug.owner}/${slug.name} is:pr is:open`)}&per_page=1`,
    ]);
    const parsed = JSON.parse(res.stdout) as { total_count?: number };
    return parsed.total_count ?? 0;
  } catch {
    return null;
  }
}

/**
 * Fetch the user's push permission on a GitHub repo.
 * Returns:
 *   - `true` if the user can push
 *   - `false` if read-only (collaborator without write access, fork upstream, etc.)
 *   - `null` if the API call fails (auth issue, 404, network), so callers can
 *     COALESCE with the previously-stored value rather than wiping it.
 */
export async function fetchCanPush(slug: GitHubSlug): Promise<boolean | null> {
  try {
    const res = await runGh([
      "api",
      "--method",
      "GET",
      `repos/${slug.owner}/${slug.name}`,
    ]);
    const parsed = JSON.parse(res.stdout) as {
      permissions?: { push?: boolean };
    };
    if (typeof parsed.permissions?.push === "boolean") {
      return parsed.permissions.push;
    }
    // Endpoint returned but didn't include `permissions` (e.g. unauthenticated
    // public-repo response). Treat as unknown rather than guessing read-only.
    return null;
  } catch {
    return null;
  }
}
