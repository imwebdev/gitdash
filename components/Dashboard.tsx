"use client";

import { useEffect, useMemo, useState } from "react";
import type { RepoView } from "@/lib/state/store";
import { RepoGroup } from "./RepoGroup";
import type { GroupKind } from "./RepoCard";
import { ThemeToggle } from "./ThemeToggle";
import { RemoteReposSection } from "./RemoteReposSection";
import { HealthBanner } from "./HealthBanner";
import { BulkActionModal } from "./BulkActionModal";

interface Props {
  initialRepos: RepoView[];
  csrfToken: string;
}

interface Group {
  kind: GroupKind;
  headline: string;
  body: string;
  explainer: ExplainerSegment[];
  defaultCollapsed?: boolean;
}

export type ExplainerSegment = { text: string; bold?: boolean };

function groupFor(repo: RepoView): GroupKind {
  const s = repo.derivedState;
  // Read-only takes priority — these repos are real, but gitdash actions
  // (push / merge / commit-push) won't work on them. They go to their own
  // bucket so we don't tease the user with buttons that will fail.
  if (s === "read-only") return "read-only";
  // 'gone' (repo missing on GitHub) lands in attention so the user notices
  // and can fix the remote URL before doing more work that has nowhere to go.
  if (s === "gone") return "attention";
  if (s === "weird") return "attention";
  if (s === "diverged") return "diverged";
  if (s === "ahead" || s === "unpushed-branch") return "push";
  if (s === "behind") return "pull";
  if (s === "dirty") return "dirty";
  // Truly local repos (no upstream config at all) go to local-only so they
  // get a "Publish to GitHub" affordance instead of being invisible inside
  // the clean bucket. We don't route `unknown` here — that means the remote
  // check just hasn't completed yet, and pretending it's local would tell
  // the user to publish a repo that may already be on GitHub.
  if (s === "no-upstream") return "local-only";
  // Everything else (clean, unknown) → "no updates needed". Comparison
  // failures default to clean rather than surfacing an "unknown" bucket
  // the user can't act on.
  return "clean";
}

function buildGroups(repos: RepoView[]): { kind: GroupKind; headline: string; body: string; explainer: ExplainerSegment[]; repos: RepoView[]; defaultCollapsed: boolean }[] {
  const buckets = new Map<GroupKind, RepoView[]>();
  for (const r of repos) {
    const g = groupFor(r);
    if (!g) continue;
    const arr = buckets.get(g) ?? [];
    arr.push(r);
    buckets.set(g, arr);
  }

  const ordered: GroupKind[] = ["attention", "diverged", "push", "pull", "dirty", "local-only", "read-only", "clean"];
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
        explainer: explainerFor(kind),
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
    case "local-only": return `${plural === "repo" ? "isn't" : "aren't"} on GitHub yet`;
    case "read-only": return `read-only — you can't push here`;
    case "clean": return n === 0
      ? "no updates needed"
      : `${plural === "repo" ? "needs" : "need"} no updates`;
  }
}

// Plain-English "what does this mean?" copy for beginners. Always visible
// under the section header so users who've never used git can still figure
// out what each section is asking of them. Bolded segments map to the
// actual button labels (Push / Pull / Commit / Merge / Publish to GitHub).
function explainerFor(kind: GroupKind): ExplainerSegment[] {
  switch (kind) {
    case "push":
      return [
        { text: "Your computer has new work that GitHub doesn't have yet. Click " },
        { text: "Push", bold: true },
        { text: " to upload it so it's safe and other computers can see it." },
      ];
    case "pull":
      return [
        { text: "GitHub has new work that your computer doesn't have yet. Click " },
        { text: "Pull", bold: true },
        { text: " to download it." },
      ];
    case "diverged":
      return [
        { text: "Your computer and GitHub both have changes the other doesn't know about. You'll need to " },
        { text: "Merge", bold: true },
        { text: " them together." },
      ];
    case "dirty":
      return [
        { text: "You changed files but haven't told git to save them yet. Click " },
        { text: "Commit & push", bold: true },
        { text: " to save a snapshot and upload it." },
      ];
    case "attention":
      return [
        { text: "Something needs your eyes — a merge conflict or a step git can't auto-resolve. Open the folder and finish what you started." },
      ];
    case "local-only":
      return [
        { text: "Never connected to GitHub. Click " },
        { text: "Publish to GitHub", bold: true },
        { text: " to back it up online — defaults to private." },
      ];
    case "read-only":
      return [
        { text: "You can look at this repo but can't push to it. Probably not yours, or a fork without write access." },
      ];
    case "clean":
      return [
        { text: "Everything is in sync with GitHub. Nothing to do here." },
      ];
  }
}

function bodyFor(kind: GroupKind, _n: number): string {
  switch (kind) {
    case "attention": return "A merge, rebase, or cherry-pick is mid-flight. Open the folder and finish what you started before touching anything else.";
    case "diverged": return "You and GitHub both have new commits on this branch. A merge will combine them; conflicts will be left in the working tree for you to resolve.";
    case "push": return "You've committed work locally that GitHub doesn't have yet. Hit the button to send it up.";
    case "pull": return "Someone (possibly another machine of yours) pushed commits to GitHub. Download them to catch up.";
    case "dirty": return "Files you've edited but haven't committed. Click Open folder to see what changed and commit from your editor. Gitdash doesn't commit for you.";
    case "local-only": return "Local repos with no GitHub remote configured. Click Publish to GitHub to create a private repo and back up your work — defaults are safe (private, push current branch).";
    case "read-only": return "Repos where your GitHub account doesn't have push access. They might have local edits — that's fine — but gitdash won't show push, merge, or commit-push buttons because they would just fail.";
    case "clean": return "These repos are in sync — nothing to push or pull. If a comparison is stale or you suspect the data is wrong, hit Fetch in the row's ⋯ menu to re-check.";
  }
}

interface BulkRunState {
  bulkRunId: string;
  repos: Array<{ id: number; name: string }>;
}

export function Dashboard({ initialRepos, csrfToken }: Props) {
  const [repos, setRepos] = useState<RepoView[]>(initialRepos);
  const [showSystem, setShowSystem] = useState(false);
  const [query, setQuery] = useState("");
  const [connected, setConnected] = useState(false);
  const [expandedRepoId, setExpandedRepoId] = useState<number | null>(null);
  const [bulkRun, setBulkRun] = useState<BulkRunState | null>(null);
  const [bulkInFlight, setBulkInFlight] = useState(false);

  useEffect(() => {
    if (expandedRepoId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedRepoId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedRepoId]);

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const url = `/api/stream?showSystem=${showSystem ? "1" : "0"}`;
      const source = new EventSource(url);
      es = source;

      source.addEventListener("open", () => {
        attempts = 0;
        setConnected(true);
      });
      source.addEventListener("snapshot", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { repos: RepoView[] };
          setRepos(data.repos);
        } catch (err) {
          console.error("[gitdash] dropped malformed snapshot SSE frame:", err);
        }
      });
      source.addEventListener("bulk", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { repos: RepoView[] };
          setRepos(data.repos);
        } catch (err) {
          console.error("[gitdash] dropped malformed bulk SSE frame:", err);
        }
      });
      source.addEventListener("update", async () => {
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
      source.onerror = () => {
        setConnected(false);
        source.close();
        if (es === source) es = null;
        if (cancelled) return;
        const delay = Math.min(30_000, 1_000 * Math.pow(2, attempts));
        attempts += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      es?.close();
    };
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

  const behindCount = useMemo(
    () => (groups.find((g) => g.kind === "pull")?.repos.length ?? 0),
    [groups],
  );

  async function handlePullAll() {
    if (bulkInFlight || behindCount === 0) return;
    setBulkInFlight(true);
    try {
      const res = await fetch("/api/bulk/pull", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        alert(body.error ?? "Pull All failed — try again");
        return;
      }
      const data = (await res.json()) as { bulkRunId: string };
      const behindRepos = groups.find((g) => g.kind === "pull")?.repos ?? [];
      setBulkRun({
        bulkRunId: data.bulkRunId,
        repos: behindRepos.map((r) => ({ id: r.id, name: r.displayName })),
      });
    } catch {
      alert("Could not start Pull All — check your connection");
    } finally {
      setBulkInFlight(false);
    }
  }

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
          {behindCount > 0 && (
            <button
              type="button"
              disabled={bulkInFlight}
              onClick={() => { void handlePullAll(); }}
              className="flex h-9 items-center gap-1.5 rounded-full bg-accent-pull px-4 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Pull All ({behindCount})
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      <HealthBanner csrfToken={csrfToken} />

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
              explainer={g.explainer}
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

      <div className="mt-5">
        <RemoteReposSection csrfToken={csrfToken} refreshKey={repos.length} />
      </div>

      <footer className="mt-16 flex items-center justify-between border-t border-border-subtle pt-6 text-[12px] text-fg-dim">
        <span>{repos.length} tracked</span>
        <span className="mono">localhost:7420</span>
      </footer>

      {bulkRun && (
        <BulkActionModal
          bulkRunId={bulkRun.bulkRunId}
          repos={bulkRun.repos}
          onClose={() => setBulkRun(null)}
        />
      )}
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
