"use client";

import { useEffect, useState, useCallback } from "react";
import { RemoteRepoCard, type RemoteRepoView } from "./RemoteRepoCard";
import { GhSignInModal } from "./GhSignInModal";
import { ChevronDown, Github } from "lucide-react";

interface ApiPayload {
  repos: RemoteRepoView[];
  cloneDir: string;
  counts: { total: number; cloneable: number; alreadyLocal: number };
  error?: string;
  detail?: string;
  hint?: string;
}

// Heuristics for detecting "you need to sign in to GitHub" from the various
// error shapes `gh` and the route can return. We treat these as a sign-in
// problem (button) rather than a generic failure (cryptic pre block).
function looksLikeAuthFailure(payload: ApiPayload): boolean {
  const haystack = [payload.error, payload.detail, payload.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!haystack) return false;
  return (
    haystack.includes("gh repo list failed") ||
    haystack.includes("gh auth") ||
    haystack.includes("not logged in") ||
    haystack.includes("authentication required") ||
    haystack.includes("unauthorized")
  );
}

interface Props {
  csrfToken: string;
  /**
   * Bumped by the parent whenever local repos change (via SSE). Triggers a
   * refresh of the remote-repos list so the card we just cloned disappears
   * once the scheduler has discovered it locally.
   */
  refreshKey?: number;
}

export function RemoteReposSection({ csrfToken, refreshKey = 0 }: Props) {
  const [repos, setRepos] = useState<RemoteRepoView[]>([]);
  const [cloneDir, setCloneDir] = useState<string>("~/repos");
  const [loadState, setLoadState] = useState<
    "idle" | "loading" | "loaded" | "error" | "needs-auth"
  >("idle");
  const [errorBlock, setErrorBlock] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  // Collapsed by default — this is a secondary, exploratory section that
  // sits below the actionable groups. Users who want to clone something
  // will click in.
  const [collapsed, setCollapsed] = useState(true);

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorBlock(null);
    try {
      const res = await fetch("/api/github/repos");
      const payload = (await res.json()) as ApiPayload;
      if (!res.ok) {
        if (looksLikeAuthFailure(payload)) {
          // No CLI hand-off: surface a single "Sign in to GitHub" button.
          // Auto-expand so the button is visible without needing a click.
          setLoadState("needs-auth");
          setCollapsed(false);
          return;
        }
        setErrorBlock(
          [payload.error ?? "GitHub API failed", payload.hint, payload.detail]
            .filter(Boolean)
            .join("\n"),
        );
        setLoadState("error");
        return;
      }
      setRepos(payload.repos ?? []);
      setCloneDir(payload.cloneDir ?? "~/repos");
      setLoadState("loaded");
    } catch (err) {
      setErrorBlock((err as Error).message ?? String(err));
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const onCloned = (slug: string) => {
    // Optimistic removal — gives instant feedback while the scheduler picks
    // up the new repo locally.
    setRepos((cur) => cur.filter((r) => r.slug !== slug));
    // Background re-fetch so other clients / state stay consistent.
    void load();
  };

  // Don't show anything if everything's already cloned and load succeeded.
  // Beginners shouldn't see an empty section noisily for no reason.
  if (loadState === "loaded" && repos.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-bg-elevated/30 p-5">
      <header className="flex items-baseline justify-between gap-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-baseline gap-2 text-left"
          aria-expanded={!collapsed}
        >
          <ChevronDown
            className={`h-4 w-4 self-center text-fg-muted transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
          <h2 className="display text-[20px] tracking-display-tight text-fg">
            on GitHub, not on this machine
          </h2>
          {loadState === "loaded" && (
            <span className="text-[12px] text-fg-dim">{repos.length}</span>
          )}
        </button>
        {loadState !== "idle" && (
          <button
            type="button"
            onClick={load}
            className="text-[11px] uppercase tracking-wider text-fg-dim hover:text-fg"
          >
            {loadState === "loading" ? "loading…" : "refresh"}
          </button>
        )}
      </header>

      {!collapsed && (
        <>
          {loadState === "loading" && repos.length === 0 && (
            <p className="mt-3 text-[13px] text-fg-muted">
              fetching your repos from GitHub…
            </p>
          )}

          {loadState === "needs-auth" && (
            <div className="mt-3 flex flex-col items-start gap-3 rounded-xl border border-border bg-bg/40 p-4">
              <p className="text-[14px] text-fg">
                Sign in to GitHub to see repos you can clone.
              </p>
              <button
                type="button"
                onClick={() => setSignInOpen(true)}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[14px] font-medium text-bg transition-colors hover:bg-accent-strong"
              >
                <Github className="h-4 w-4" />
                Sign in to GitHub
              </button>
            </div>
          )}

          {loadState === "error" && (
            <pre className="mono mt-3 whitespace-pre-wrap rounded bg-bg-elevated/80 p-3 text-[12px] text-accent-attention">
              {errorBlock}
            </pre>
          )}

          {loadState === "loaded" && repos.length > 0 && (
            <p className="mt-2 text-[13px] text-fg-muted">
              one click clones into{" "}
              <span className="mono">{cloneDir}</span>. configure with{" "}
              <span className="mono">cloneDir</span> in{" "}
              <span className="mono">~/.config/gitdash/config.json</span>.
            </p>
          )}

          <div className="mt-3 flex flex-col gap-2">
            {repos.map((r) => (
              <RemoteRepoCard
                key={r.slug}
                repo={r}
                cloneDir={cloneDir}
                csrfToken={csrfToken}
                onCloned={onCloned}
              />
            ))}
          </div>
        </>
      )}

      {signInOpen && (
        <GhSignInModal
          csrfToken={csrfToken}
          onClose={() => setSignInOpen(false)}
          onSuccess={() => {
            // After successful auth, reload the repo list. The modal stays
            // open showing "Done" until the user dismisses it.
            void load();
          }}
        />
      )}
    </section>
  );
}
