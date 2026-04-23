import { runGh } from "@/lib/git/exec";
import { getDb } from "@/lib/db/schema";
import type { GitHubSlug } from "@/lib/scan/discover";

export type RemoteState = "clean" | "ahead" | "behind" | "diverged" | "no-upstream" | "unknown";

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
 * Run `gh api --include` and ALWAYS return whatever stdout we got, even if
 * the process exited non-zero. `gh` exits 1 on non-2xx HTTP responses
 * (including 304 Not Modified for conditional requests), but the full
 * response headers + body are still written to stdout. The previous
 * implementation treated those exits as fatal failures and dropped the
 * payload, which silently broke ETag caching — every cached repo got
 * classified as remoteState="unknown" instead of using the cached SHA.
 *
 * Bug history: closes #17.
 */
async function runGhApiIncluded(
  args: string[],
  timeoutMs: number,
): Promise<{ raw: string; thrownStderr: string }> {
  try {
    const res = await runGh(args, { timeoutMs });
    return { raw: res.stdout, thrownStderr: "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { raw: e.stdout ?? "", thrownStderr: e.stderr ?? "" };
  }
}

/**
 * Fetch remote tip SHA for a branch using `gh api` with ETag caching.
 * Returns null on auth / 404 / parse failure. 304 cache-hits use the
 * cached body's SHA.
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

  const { raw, thrownStderr } = await runGhApiIncluded(args, 15_000);

  // No payload at all → genuine failure (network, command not found, etc.)
  if (!raw) {
    if (/404/.test(thrownStderr)) return null;
    console.error(`[gh] fetchRemoteSha empty payload for ${slug.owner}/${slug.name}@${branch}: ${thrownStderr.trim()}`);
    return null;
  }

  const { statusCode, etag, body } = parseIncludedResponse(raw);

  if (statusCode === 304 && cached) {
    try {
      const parsed = JSON.parse(cached.body_json) as { sha?: string };
      if (parsed.sha) return { sha: parsed.sha, fromCache: true };
    } catch {
      // cached body unparseable — fall through and treat as miss
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

  // 4xx/5xx → log and fall back to cached SHA if available, else null
  console.error(`[gh] fetchRemoteSha ${statusCode} for ${slug.owner}/${slug.name}@${branch}`);
  if (cached) {
    try {
      const parsed = JSON.parse(cached.body_json) as { sha?: string };
      if (parsed.sha) return { sha: parsed.sha, fromCache: true };
    } catch {
      // fall through
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

  const { raw, thrownStderr } = await runGhApiIncluded(args, 15_000);
  if (!raw) {
    console.error(`[gh] compareWithRemote empty payload for ${slug.owner}/${slug.name}: ${thrownStderr.trim()}`);
    return { state: "unknown", ahead: 0, behind: 0, remoteSha: remote.sha, localSha, checkedAt: now };
  }

  const parsed = parseIncludedResponse(raw);

  if (parsed.statusCode === 304 && cachedCmp) {
    try {
      const body = JSON.parse(cachedCmp.body_json) as {
        ahead_by?: number;
        behind_by?: number;
        status?: string;
      };
      return comparisonFromBody(body, remote.sha, localSha, now);
    } catch {
      // cached body unparseable — fall through to unknown
    }
  }

  if (parsed.statusCode >= 200 && parsed.statusCode < 300) {
    try {
      const body = JSON.parse(parsed.body) as {
        ahead_by?: number;
        behind_by?: number;
        status?: string;
      };
      if (parsed.etag) writeCache(compareKey, parsed.etag, parsed.body, now);
      return comparisonFromBody(body, remote.sha, localSha, now);
    } catch {
      // body parse fail → unknown
    }
  }

  if (parsed.statusCode >= 400) {
    console.error(`[gh] compareWithRemote ${parsed.statusCode} for ${slug.owner}/${slug.name}`);
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

export async function fetchOpenPrCount(slug: GitHubSlug): Promise<number> {
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
    return 0;
  }
}
