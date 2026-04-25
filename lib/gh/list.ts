import { runGh } from "@/lib/git/exec";
import { getDb } from "@/lib/db/schema";

export interface RemoteRepoInfo {
  /** owner/name slug — primary key for cross-referencing local clones */
  slug: string;
  owner: string;
  name: string;
  description: string | null;
  /** ISO 8601 from GitHub, surfaced as-is so the client can format. */
  pushedAt: string | null;
  /** True if this is a fork. Surfaced so UI can dim or label them. */
  isFork: boolean;
  /** True if archived. Same. */
  isArchived: boolean;
  /** True if private — only relevant for badges in the UI. */
  isPrivate: boolean;
  /** GitHub web URL — for "open on GitHub" affordance later. */
  url: string;
}

/**
 * Shape of a single row from `gh repo list --json ...`. Subset of GitHub's
 * Repository object; only the fields we ask for via --json show up.
 */
interface GhRepoListRow {
  name: string;
  description: string | null;
  pushedAt: string | null;
  isFork: boolean;
  isArchived: boolean;
  isPrivate: boolean;
  url: string;
  owner: { login: string };
}

const GH_LIST_FIELDS = [
  "name",
  "description",
  "pushedAt",
  "isFork",
  "isArchived",
  "isPrivate",
  "url",
  "owner",
].join(",");

/**
 * Fetch the authenticated user's repos. Limits at 200 — enough for >95% of
 * users; if anyone has more they can paginate via `gh repo list` directly
 * for now (a follow-up issue can add server-side pagination if needed).
 */
export async function fetchUserGithubRepos(): Promise<RemoteRepoInfo[]> {
  const { stdout } = await runGh(
    ["repo", "list", "--limit", "200", "--json", GH_LIST_FIELDS],
    { timeoutMs: 20_000 },
  );

  const rows = JSON.parse(stdout) as GhRepoListRow[];
  return rows.map((row) => ({
    slug: `${row.owner.login}/${row.name}`,
    owner: row.owner.login,
    name: row.name,
    description: row.description,
    pushedAt: row.pushedAt,
    isFork: row.isFork,
    isArchived: row.isArchived,
    isPrivate: row.isPrivate,
    url: row.url,
  }));
}

/**
 * Slugs (owner/name lowercase) of repos we already know about locally.
 * Used to filter `fetchUserGithubRepos` so we don't show "clone me" cards
 * for repos already cloned on this machine.
 */
export function getKnownGithubSlugs(): Set<string> {
  const rows = getDb()
    .prepare<[], { owner: string | null; name: string | null }>(
      `SELECT github_owner AS owner, github_name AS name
         FROM repos
        WHERE deleted_at IS NULL
          AND github_owner IS NOT NULL
          AND github_name IS NOT NULL`,
    )
    .all();
  const out = new Set<string>();
  for (const row of rows) {
    if (!row.owner || !row.name) continue;
    out.add(`${row.owner.toLowerCase()}/${row.name.toLowerCase()}`);
  }
  return out;
}

/** Filter remote repos to only those NOT already cloned locally. */
export function filterCloneable(
  remote: RemoteRepoInfo[],
  knownSlugs: Set<string>,
): RemoteRepoInfo[] {
  return remote.filter((r) => !knownSlugs.has(r.slug.toLowerCase()));
}
