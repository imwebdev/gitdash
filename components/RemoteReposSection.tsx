"use client";

import { useEffect, useState, useCallback } from "react";
import { RemoteRepoCard, type RemoteRepoView } from "./RemoteRepoCard";
import { ChevronDown } from "lucide-react";

interface ApiPayload {
  repos: RemoteRepoView[];
  cloneDir: string;
  counts: { total: number; cloneable: number; alreadyLocal: number };
  error?: string;
  detail?: string;
  hint?: string;
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
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [errorBlock, setErrorBlock] = useState<string | null>(null);
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
    </section>
  );
}
