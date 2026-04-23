"use client";

import { useEffect, useMemo, useState } from "react";
import type { RepoView, DerivedState } from "@/lib/state/store";
import { RepoRow } from "./RepoRow";
import { Legend } from "./Legend";

interface Props {
  initialRepos: RepoView[];
  csrfToken: string;
}

const STATE_PRIORITY: Record<DerivedState, number> = {
  weird: 0,
  diverged: 1,
  dirty: 2,
  behind: 3,
  ahead: 4,
  "no-upstream": 5,
  unknown: 6,
  clean: 7,
};

export function Dashboard({ initialRepos, csrfToken }: Props) {
  const [repos, setRepos] = useState<RepoView[]>(initialRepos);
  const [showSystem, setShowSystem] = useState(false);
  const [query, setQuery] = useState("");
  const [connected, setConnected] = useState(false);

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
      // Simplest approach: refetch list; cheap enough at this scale.
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
    const list = q
      ? repos.filter(
          (r) =>
            r.displayName.toLowerCase().includes(q) ||
            r.repoPath.toLowerCase().includes(q) ||
            (r.githubOwner && r.githubOwner.toLowerCase().includes(q)) ||
            (r.githubName && r.githubName.toLowerCase().includes(q)),
        )
      : repos;
    return [...list].sort((a, b) => {
      const pa = STATE_PRIORITY[a.derivedState];
      const pb = STATE_PRIORITY[b.derivedState];
      if (pa !== pb) return pa - pb;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [repos, query]);

  const counts = useMemo(() => {
    const c = { weird: 0, diverged: 0, dirty: 0, behind: 0, ahead: 0, clean: 0, total: filtered.length };
    for (const r of filtered) {
      if (r.derivedState === "weird") c.weird++;
      else if (r.derivedState === "diverged") c.diverged++;
      else if (r.derivedState === "dirty") c.dirty++;
      else if (r.derivedState === "behind") c.behind++;
      else if (r.derivedState === "ahead") c.ahead++;
      else if (r.derivedState === "clean") c.clean++;
    }
    return c;
  }, [filtered]);

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center gap-4 px-4 py-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight">gitdash</h1>
            <div className="text-[11px] text-muted-foreground">
              {connected ? "● live" : "○ reconnecting…"} · {counts.total} repos
            </div>
          </div>
          <div className="ml-6 flex items-center gap-2 text-xs">
            <CountPill label="weird" value={counts.weird} color="text-status-weird" />
            <CountPill label="diverged" value={counts.diverged} color="text-status-diverged" />
            <CountPill label="dirty" value={counts.dirty} color="text-status-dirty" />
            <CountPill label="behind" value={counts.behind} color="text-status-behind" />
            <CountPill label="ahead" value={counts.ahead} color="text-status-ahead" />
            <CountPill label="clean" value={counts.clean} color="text-status-clean" />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <input
              type="search"
              placeholder="filter…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-56 rounded border border-border bg-background px-2 text-xs focus:border-ring focus:outline-none"
            />
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showSystem}
                onChange={(e) => setShowSystem(e.target.checked)}
                className="h-3.5 w-3.5 accent-foreground"
              />
              show system repos
            </label>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(180px,1fr)_100px_120px_80px_110px_minmax(460px,auto)] gap-3 border-t border-border px-4 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <div title="Repo folder name and current branch. Second line shows the full path on disk.">
            repo / branch
          </div>
          <div title="How many commits your local branch is ahead ↑ or behind ↓ GitHub.">
            vs github
          </div>
          <div title="Files you've changed but haven't committed yet. Number in parens = brand-new untracked files.">
            uncommitted
          </div>
          <div title="How long ago the most recent commit was made on the current branch.">
            last commit
          </div>
          <div title="GitHub owner/name (parsed from the remote URL).">github slug</div>
          <div
            className="text-right"
            title="Per-repo actions. Hover any button for what it does. Expand the help bar at top for full explanations."
          >
            actions
          </div>
        </div>
      </header>

      <Legend />

      <div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {repos.length === 0 ? "scanning repos…" : "no repos match your filter"}
          </div>
        ) : (
          filtered.map((repo) => (
            <RepoRow key={repo.id} repo={repo} csrfToken={csrfToken} />
          ))
        )}
      </div>
    </main>
  );
}

function CountPill({ label, value, color }: { label: string; value: number; color: string }) {
  if (value === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded border border-border bg-muted/30 px-1.5 py-0.5 ${color}`}>
      <span className="font-medium tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
