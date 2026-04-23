"use client";

import { cn } from "@/lib/utils";
import type { RepoView } from "@/lib/state/store";
import { ActionModal } from "./ActionModal";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  GitPullRequest,
  RefreshCw,
} from "lucide-react";

export type GroupKind = "push" | "pull" | "diverged" | "attention" | "dirty" | "clean";

export const ROW_GRID =
  "grid-cols-[minmax(180px,1.4fr)_120px_150px_minmax(200px,1.6fr)_80px_148px_72px]";

function primaryAction(
  kind: GroupKind,
  hasRemote: boolean,
  hasConflicts: boolean,
): { label: string; action: string | null } {
  if (kind === "push") return { label: "Push", action: "push" };
  if (kind === "pull") return { label: "Pull", action: "pull" };
  if (kind === "diverged") return { label: "Merge", action: "merge" };
  if (kind === "dirty" && !hasConflicts && hasRemote) {
    return { label: "Commit & push", action: "commit-push" };
  }
  // No primary button for: attention, dirty+conflicts, dirty+no-remote, clean.
  // User handles those externally; the icon buttons (Refresh + Open on GitHub)
  // are still available in the actions column.
  return { label: "", action: null };
}

function relativeTime(unix: number | null | undefined): string {
  if (!unix) return "—";
  const deltaSec = Math.floor(Date.now() / 1000 - unix);
  if (deltaSec < 60) return "just now";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  if (deltaSec < 86400 * 30) return `${Math.floor(deltaSec / 86400)}d ago`;
  if (deltaSec < 86400 * 365) return `${Math.floor(deltaSec / (86400 * 30))}mo ago`;
  return `${Math.floor(deltaSec / (86400 * 365))}y ago`;
}

interface Props {
  repo: RepoView;
  kind: GroupKind;
  csrfToken: string;
}

export function RepoCard({ repo, kind, csrfToken }: Props) {
  const [modalAction, setModalAction] = useState<string | null>(null);
  const snap = repo.snapshot;

  const ghOwner = repo.githubOwner;
  const ghName = repo.githubName;
  const ghUrl = ghOwner && ghName ? `https://github.com/${ghOwner}/${ghName}` : null;
  const ghPrUrl = ghUrl ? `${ghUrl}/pulls` : null;

  const ahead = Math.max(snap?.ahead ?? 0, snap?.remoteAhead ?? 0);
  const behind = Math.max(snap?.behind ?? 0, snap?.remoteBehind ?? 0);
  const dirtyTotal = snap
    ? snap.dirtyTracked + snap.staged + snap.untracked + snap.conflicted
    : 0;
  const newFiles = snap?.untracked ?? 0;
  const conflicts = snap?.conflicted ?? 0;
  const hasRemote = !!(ghUrl ?? snap?.remoteUrl);

  const button = primaryAction(kind, hasRemote, conflicts > 0);

  return (
    <>
      <div
        className={cn(
          "group relative grid items-center gap-x-4 px-6 py-3 transition-colors hover:bg-bg-hover/60",
          ROW_GRID,
        )}
      >
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate text-[14px] font-medium tracking-tight text-fg">
            {repo.displayName}
          </h3>
          <span className="mono truncate text-[11px] text-fg-dim">
            {snap?.detached
              ? "(detached HEAD)"
              : snap?.branch ?? "—"}
          </span>
        </div>

        <SyncCell ahead={ahead} behind={behind} hasUpstream={!!snap?.upstream} kind={kind} />

        <LocalCell
          dirty={dirtyTotal}
          newFiles={newFiles}
          conflicts={conflicts}
          kind={kind}
        />

        <LastCommitCell
          subject={snap?.lastCommitSubject ?? null}
          ts={snap?.lastCommitTs ?? null}
        />

        <PrCell count={snap?.openPrCount ?? 0} url={ghPrUrl} />

        {button.action ? (
          <button
            onClick={() => setModalAction(button.action)}
            className={cn(
              "shrink-0 justify-self-start whitespace-nowrap rounded-full border px-3.5 py-1 text-[12px] font-medium tracking-tight transition-all",
              kind === "push" &&
                "border-accent-push/35 bg-accent-push/10 text-accent-push hover:border-accent-push/55 hover:bg-accent-push/20",
              kind === "pull" &&
                "border-accent-pull/35 bg-accent-pull/10 text-accent-pull hover:border-accent-pull/55 hover:bg-accent-pull/20",
              kind === "diverged" &&
                "border-accent-diverged/35 bg-accent-diverged/10 text-accent-diverged hover:border-accent-diverged/55 hover:bg-accent-diverged/20",
              kind === "dirty" &&
                "border-accent-dirty/35 bg-accent-dirty/10 text-accent-dirty hover:border-accent-dirty/55 hover:bg-accent-dirty/20",
            )}
          >
            {button.label}
          </button>
        ) : (
          <span />
        )}

        <RowIcons
          ghUrl={ghUrl}
          repoId={repo.id}
          csrfToken={csrfToken}
        />
      </div>

      {modalAction && (
        <ActionModal
          repo={repo}
          action={modalAction}
          csrfToken={csrfToken}
          onClose={() => setModalAction(null)}
        />
      )}
    </>
  );
}

function SyncCell({
  ahead,
  behind,
  hasUpstream,
  kind: _kind,
}: {
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  kind: GroupKind;
}) {
  if (!hasUpstream) {
    return <span className="text-[12px] text-fg-dim">no upstream</span>;
  }
  if (ahead === 0 && behind === 0) {
    return <span className="text-[12px] text-fg-dim">in sync</span>;
  }
  return (
    <div className="flex items-center gap-3 text-[13px] tabular-nums">
      {ahead > 0 && (
        <span className="inline-flex items-center gap-1 text-accent-push">
          <ArrowUp className="h-3 w-3" />
          {ahead}
        </span>
      )}
      {behind > 0 && (
        <span className="inline-flex items-center gap-1 text-accent-pull">
          <ArrowDown className="h-3 w-3" />
          {behind}
        </span>
      )}
    </div>
  );
}

function LocalCell({
  dirty,
  newFiles,
  conflicts,
  kind: _kind,
}: {
  dirty: number;
  newFiles: number;
  conflicts: number;
  kind: GroupKind;
}) {
  if (conflicts > 0) {
    return (
      <span className="text-[12px] font-medium text-accent-attention">
        {conflicts} conflict{conflicts === 1 ? "" : "s"}
      </span>
    );
  }
  if (dirty === 0) {
    return <span className="text-[12px] text-fg-dim">clean</span>;
  }
  return (
    <div className="flex flex-col text-[12px] leading-tight">
      <span className="text-accent-dirty">
        {dirty} unsaved
      </span>
      {newFiles > 0 && (
        <span className="text-fg-dim">
          {newFiles} new
        </span>
      )}
    </div>
  );
}

function LastCommitCell({
  subject,
  ts,
}: {
  subject: string | null;
  ts: number | null;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-[12px] text-fg-muted" title={subject ?? undefined}>
        {subject ?? "—"}
      </span>
      <span className="mono text-[11px] text-fg-dim">{relativeTime(ts)}</span>
    </div>
  );
}

function PrCell({ count, url }: { count: number; url: string | null }) {
  if (!url || count === 0) {
    return <span className="text-[12px] text-fg-dim">—</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted hover:text-fg"
      title={`${count} open pull request${count === 1 ? "" : "s"} on GitHub`}
    >
      <GitPullRequest className="h-3.5 w-3.5" />
      <span className="tabular-nums">{count}</span>
    </a>
  );
}

function RowIcons({
  ghUrl,
  repoId,
  csrfToken,
}: {
  ghUrl: string | null;
  repoId: number;
  csrfToken: string;
}) {
  const [refreshState, setRefreshState] = useState<"idle" | "spinning" | "error">("idle");

  const onRefresh = async () => {
    if (refreshState === "spinning") return;
    setRefreshState("spinning");
    try {
      const res = await fetch(`/api/repos/${repoId}/refresh`, {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!res.ok) {
        setRefreshState("error");
        setTimeout(() => setRefreshState("idle"), 1500);
      } else {
        setRefreshState("idle");
      }
    } catch {
      setRefreshState("error");
      setTimeout(() => setRefreshState("idle"), 1500);
    }
  };

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={onRefresh}
        title={
          refreshState === "error"
            ? "Refresh failed — see server logs"
            : "Re-check this repo against GitHub"
        }
        aria-label="Refresh"
        disabled={refreshState === "spinning"}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors",
          refreshState === "error"
            ? "text-accent-attention"
            : "text-fg-dim hover:bg-bg-hover hover:text-fg",
          refreshState === "spinning" && "cursor-wait",
        )}
      >
        <RefreshCw
          className={cn("h-3.5 w-3.5", refreshState === "spinning" && "animate-spin")}
        />
      </button>
      {ghUrl ? (
        <a
          href={ghUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open on GitHub"
          aria-label="Open on GitHub"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-fg-dim transition-colors hover:bg-bg-hover hover:text-fg"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : (
        <span
          className="inline-flex h-7 w-7 items-center justify-center text-fg-dim opacity-30"
          title="No GitHub remote"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );
}
