"use client";

import { useEffect, useMemo, useState } from "react";
import type { RepoView } from "@/lib/state/store";
import { RepoGroup } from "./RepoGroup";
import type { GroupKind } from "./RepoCard";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  initialRepos: RepoView[];
  csrfToken: string;
}

interface Group {
  kind: GroupKind;
  headline: string;
  body: string;
  defaultCollapsed?: boolean;
}

function groupFor(repo: RepoView): GroupKind {
  const s = repo.derivedState;
  if (s === "weird") return "attention";
  if (s === "read-only") return "read-only";
  if (s === "diverged") return "diverged";
  if (s === "ahead") return "push";
  if (s === "behind") return "pull";
  if (s === "dirty") return "dirty";
  // Everything else (clean, no-upstream, unknown) → "no updates needed".
  // Comparison failures and missing remotes default to clean rather than
  // surfacing an "unknown" bucket the user can't act on. If the comparison
  // is truly stale and a real divergence is hiding, the user'll find out
  // when they hit Fetch in the row's ⋯ menu.
  return "clean";
}

function buildGroups(repos: RepoView[]): { kind: GroupKind; headline: string; body: string; repos: RepoView[]; defaultCollapsed: boolean }[] {
  const buckets = new Map<GroupKind, RepoView[]>();
  for (const r of repos) {
    const g = groupFor(r);
    if (!g) continue;
    const arr = buckets.get(g) ?? [];
    arr.push(r);
    buckets.set(g, arr);
  }

  const ordered: GroupKind[] = ["attention", "diverged", "push", "pull", "dirty", "read-only", "clean"];
  // "clean" always renders (with an empty-state placeholder when count = 0)
  return ordered
    .filter((k) => k === "clean" || (buckets.get(k) ?? []).length > 0)
    .map((kind) => {
      const list = (buckets.get(kind) ?? []).slice();
      list.sort((a, b) => a.displayName.localeCompare(b.displayName));
      return {
        kind,
        headline: headlineFor(kind, list.length),
        body: bodyFor(kind, list.length),
        repos: list,
        defaultCollapsed: false,
      };
    });
}

function headlineFor(kind: GroupKind, n: number): string {
  const plural = n === 1 ? "repo" : "repos";
  switch (kind) {
    case "attention": return `${n === 1 ? "needs" : "need"} your attention`;
    case "diverged": return `${plural === "repo" ? "has" : "have"} diverged from GitHub`;
    case "push": return `${plural === "repo" ? "wants" : "want"} to be pushed`;
    case "pull": return `${plural === "repo" ? "has" : "have"} incoming changes`;
    case "dirty": return `${plural === "repo" ? "has" : "have"} unsaved changes`;
    case "read-only": return "read-only — no push access";
    case "clean": return n === 0
      ? "no updates needed"
      : `${plural === "repo" ? "needs" : "need"} no updates`;
  }
}

function bodyFor(kind: GroupKind, _n: number): string {
  switch (kind) {
    case "attention": return "A merge, rebase, or cherry-pick is mid-flight. Open the folder and finish what you started before touching anything else.";
    case "diverged": return "You and GitHub both have new commits on this branch. A merge will combine them; conflicts will be left in the working tree for you to resolve.";
    case "push": return "You've committed work locally that GitHub doesn't have yet. Hit the button to send it up.";
    case "pull": return "Someone (possibly another machine of yours) pushed commits to GitHub. Download them to catch up.";
    case "dirty": return "Files you've edited but haven't committed. Click Open folder to see what changed and commit from your editor. Gitdash doesn't commit for you.";
    case "read-only": return "Your GitHub token doesn't have push access to these repos. Pull and Fetch still work from the ⋯ menu, but Push, Commit & push, and Merge are hidden — they'd just fail.";
    case "clean": return "These repos are in sync — nothing to push or pull. If a comparison is stale or you suspect the data is wrong, hit Fetch in the row's ⋯ menu to re-check.";
  }
}

export function Dashboard({ initialRepos, csrfToken }: Props) {
  const [repos, setRepos] = useState<RepoView[]>(initialRepos);
  const [showSystem, setShowSystem] = useState(false);
  const [query, setQuery] = useState("");
  const [connected, setConnected] = useState(false);
  const [expandedRepoId, setExpandedRepoId] = useState<number | null>(null);

  useEffect(() => {
    if (expandedRepoId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedRepoId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedRepoId]);

  useEffect(() => {
    const url = `/api/stream?showSystem=${showSystem ? "1" : "0"}`;
    const es = new EventSource(url);
    es.addEventListener("snapshot", (ev) => {
      setConnected(true);
      const data = JSON.parse((ev as MessageEvent).data) as { repos: RepoView[] };
      setRepos(data.repos);
    });
    es.addEventListener("bulk", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { repos: RepoView[] };
      setRepos(data.repos);
    });
    es.addEventListener("update", async () => {
      try {
        const res = await fetch(`/api/repos?showSystem=${showSystem ? "1" : "0"}`);
        if (res.ok) {
          const data = (await res.json()) as { repos: RepoView[] };
          setRepos(data.repos);
        }
      } catch {
        // ignore
      }
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [showSystem]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.repoPath.toLowerCase().includes(q) ||
        (r.githubOwner && r.githubOwner.toLowerCase().includes(q)) ||
        (r.githubName && r.githubName.toLowerCase().includes(q)),
    );
  }, [repos, query]);

  const groups = useMemo(() => buildGroups(filtered), [filtered]);

  const actionableCount = useMemo(
    () =>
      groups
        .filter((g) => g.kind !== "clean" && g.kind !== "dirty")
        .reduce((n, g) => n + g.repos.length, 0),
    [groups],
  );

  return (
    <main className="grain relative mx-auto max-w-[1280px] px-4 py-8 sm:px-10 sm:py-14">
      <header className="mb-8 flex flex-col gap-5 sm:mb-12 sm:gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="display text-[36px] leading-none tracking-display-tight text-fg sm:text-[44px]">
            gitdash
          </h1>
          <p className="mt-3 max-w-lg text-[14px] text-fg-muted sm:text-[15px]">
            {actionableCount === 0 ? (
              <>Nothing urgent. <span className="display-italic text-fg">All caught up.</span></>
            ) : (
              <>
                <span className="display-italic text-fg">{actionableCount}</span> {actionableCount === 1 ? "repo wants" : "repos want"} something from you.
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <input
            type="search"
            placeholder="filter repos"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full rounded-full border border-border bg-bg-elevated/60 px-4 text-[14px] text-fg placeholder:text-fg-dim focus:border-ring focus:outline-none sm:h-9 sm:w-56 sm:text-[13px]"
          />
          <label className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-fg-muted">
            <input
              type="checkbox"
              checked={showSystem}
              onChange={(e) => setShowSystem(e.target.checked)}
              className="h-3.5 w-3.5 accent-accent-push"
            />
            system repos
          </label>
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-fg-dim">
            <span
              className={
                connected
                  ? "h-1.5 w-1.5 rounded-full bg-accent-clean"
                  : "h-1.5 w-1.5 rounded-full bg-accent-attention animate-pulse"
              }
            />
            {connected ? "live" : "reconnecting"}
          </div>
          <ThemeToggle />
        </div>
      </header>

      {groups.length === 0 ? (
        <EmptyState hasRepos={repos.length > 0} />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <RepoGroup
              key={g.kind}
              kind={g.kind}
              headline={g.headline}
              body={g.body}
              repos={g.repos}
              csrfToken={csrfToken}
              defaultCollapsed={g.defaultCollapsed}
              expandedRepoId={expandedRepoId}
              onToggleRepo={(id) =>
                setExpandedRepoId((cur) => (cur === id ? null : id))
              }
            />
          ))}
        </div>
      )}

      <footer className="mt-16 flex items-center justify-between border-t border-border-subtle pt-6 text-[12px] text-fg-dim">
        <span>{repos.length} tracked</span>
        <span className="mono">localhost:7420</span>
      </footer>
    </main>
  );
}

function EmptyState({ hasRepos }: { hasRepos: boolean }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <p className="display text-[28px] tracking-display-tight text-fg">
        {hasRepos ? "No matches." : "Scanning your repos."}
      </p>
      <p className="max-w-sm text-[14px] text-fg-muted">
        {hasRepos
          ? "Try a different filter, or clear it to see everything."
          : "This takes a few seconds on first boot. Staggered GitHub comparison finishes within a minute."}
      </p>
    </div>
  );
}
