"use client";

import { cn } from "@/lib/utils";
import type { RepoView } from "@/lib/state/store";
import { ActionModal } from "./ActionModal";
import { RowDetail } from "./RowDetail";
import { useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  GitPullRequest,
  RefreshCw,
} from "lucide-react";

type PillTone = "push" | "pull" | "clean" | "dirty" | "attention" | "neutral";

const PILL_TONE: Record<PillTone, string> = {
  push: "border-accent-push/30 bg-accent-push/10 text-accent-push",
  pull: "border-accent-pull/30 bg-accent-pull/10 text-accent-pull",
  clean: "border-accent-clean/30 bg-accent-clean/10 text-accent-clean",
  dirty: "border-accent-dirty/30 bg-accent-dirty/10 text-accent-dirty",
  attention: "border-accent-attention/30 bg-accent-attention/10 text-accent-attention",
  neutral: "border-fg-dim/30 bg-fg-dim/10 text-fg-muted",
};

function Pill({ tone, children, className }: { tone: PillTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
        PILL_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export type GroupKind =
  | "push"
  | "pull"
  | "diverged"
  | "attention"
  | "dirty"
  | "local-only"
  | "read-only"
  | "clean";

export const ROW_GRID =
  "grid-cols-[minmax(180px,1.4fr)_120px_150px_minmax(200px,1.6fr)_80px_220px_104px]";

interface ActionButton {
  label: string;
  action: string;
  variant: "primary" | "secondary";
}

// Returns 0, 1, or 2 buttons. Dirty rows with a remote get two side by side
// (Commit + Commit & push) so a failed push doesn't force the user to retype
// their commit message — they just hit Push afterward.
function primaryActions(
  kind: GroupKind,
  hasRemote: boolean,
  hasConflicts: boolean,
): ActionButton[] {
  if (kind === "read-only") return [];
  if (kind === "push") return [{ label: "Push", action: "push", variant: "primary" }];
  if (kind === "pull") return [{ label: "Pull", action: "pull", variant: "primary" }];
  if (kind === "diverged") return [{ label: "Merge", action: "merge", variant: "primary" }];
  if (kind === "dirty" && !hasConflicts) {
    if (hasRemote) {
      return [
        { label: "Commit", action: "commit", variant: "secondary" },
        { label: "Commit & push", action: "commit-push", variant: "primary" },
        { label: "Backup WIP", action: "wip-stash-push", variant: "secondary" },
      ];
    }
    return [{ label: "Commit", action: "commit", variant: "primary" }];
  }
  if (kind === "local-only") {
    return [{ label: "Publish to GitHub", action: "publish-to-github", variant: "primary" }];
  }
  return [];
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

function actionButtonClass(kind: GroupKind, variant: "primary" | "secondary"): string {
  // Secondary variant is a quieter, outline-only style so two side-by-side
  // buttons in the dirty row create a visual primary/secondary hierarchy
  // (Commit & push wins; Commit is available but recedes).
  if (variant === "secondary") {
    return cn(
      "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[12px] font-medium tracking-tight transition-all",
      "border-border bg-transparent text-fg-muted hover:border-fg-muted hover:text-fg",
    );
  }
  return cn(
    "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1 text-[12px] font-medium tracking-tight transition-all",
    kind === "push" &&
      "border-accent-push/35 bg-accent-push/10 text-accent-push hover:border-accent-push/55 hover:bg-accent-push/20",
    kind === "pull" &&
      "border-accent-pull/35 bg-accent-pull/10 text-accent-pull hover:border-accent-pull/55 hover:bg-accent-pull/20",
    kind === "diverged" &&
      "border-accent-diverged/35 bg-accent-diverged/10 text-accent-diverged hover:border-accent-diverged/55 hover:bg-accent-diverged/20",
    kind === "dirty" &&
      "border-accent-dirty/35 bg-accent-dirty/10 text-accent-dirty hover:border-accent-dirty/55 hover:bg-accent-dirty/20",
    kind === "local-only" &&
      "border-accent-local-only/35 bg-accent-local-only/10 text-accent-local-only hover:border-accent-local-only/55 hover:bg-accent-local-only/20",
  );
}

interface Props {
  repo: RepoView;
  kind: GroupKind;
  csrfToken: string;
  expanded: boolean;
  onToggle: () => void;
}

export function RepoCard({ repo, kind, csrfToken, expanded, onToggle }: Props) {
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
  const buttons = primaryActions(kind, hasRemote, conflicts > 0);
  const prCount = snap?.openPrCount ?? 0;

  const handleRowClick = (e: React.MouseEvent) => {
    // If the click came from something inside the row that already handles clicks
    // (button, a, input), stopPropagation on those elements prevents this.
    // Any remaining click on the row surface → toggle.
    if (e.defaultPrevented) return;
    onToggle();
  };

  const handleRowKey = (e: React.KeyboardEvent) => {
    // Only toggle when the row itself is focused; let buttons/links handle
    // their own Enter/Space without bubbling into a row toggle.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <>
      <div
        className={cn(
          "group relative cursor-pointer transition-colors hover:bg-bg-hover/60",
          expanded && "bg-bg-hover/40",
        )}
        onClick={handleRowClick}
        onKeyDown={handleRowKey}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`Toggle details for ${repo.displayName}`}
      >
        {/* Desktop grid row (>= sm). Preserves the existing layout verbatim. */}
        <div
          className={cn(
            "hidden items-center gap-x-4 px-6 py-3 sm:grid",
            ROW_GRID,
          )}
        >
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-1">
              <h3 className="truncate text-[14px] font-medium tracking-tight text-fg">
                {repo.displayName}
              </h3>
              {snap?.remoteState === "unknown" &&
                (snap.remoteCheckedAt === null || Date.now() - snap.remoteCheckedAt > 5 * 60 * 1000) && (
                  <span
                    className="shrink-0 text-[11px] text-accent-attention"
                    title="Remote check is stuck. Possible causes: branch removed on GitHub, auth expired, repo renamed/deleted. Click refresh to retry."
                    aria-label="Remote check is stuck"
                  >
                    ⚠
                  </span>
                )}
            </div>
            <span className="mono truncate text-[11px] text-fg-dim">
              {snap?.detached ? "(detached HEAD)" : snap?.branch ?? "—"}
            </span>
          </div>

          <SyncCell ahead={ahead} behind={behind} hasUpstream={!!snap?.upstream} />
          <LocalCell dirty={dirtyTotal} newFiles={newFiles} conflicts={conflicts} />
          <LastCommitCell
            subject={snap?.lastCommitSubject ?? null}
            ts={snap?.lastCommitTs ?? null}
          />
          <PrCell count={prCount} url={ghPrUrl} />

          {buttons.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 justify-self-start">
              {buttons.map((b) => (
                <button
                  key={b.action}
                  onClick={(e) => {
                    e.stopPropagation();
                    setModalAction(b.action);
                  }}
                  className={actionButtonClass(kind, b.variant)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          ) : (
            <span />
          )}

          <RowIcons
            ghUrl={ghUrl}
            repoId={repo.id}
            csrfToken={csrfToken}
            expanded={expanded}
            snap={snap}
            onModalAction={setModalAction}
          />
        </div>

        {/* Mobile stacked card (< sm). */}
        <div className="flex flex-col gap-3 px-4 py-3.5 sm:hidden">
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <h3 className="truncate text-[15px] font-medium tracking-tight text-fg">
                {repo.displayName}
              </h3>
              <span className="mono truncate text-[11px] text-fg-dim">
                {snap?.detached ? "(detached HEAD)" : snap?.branch ?? "—"}
              </span>
            </div>
            <RowIcons
              ghUrl={ghUrl}
              repoId={repo.id}
              csrfToken={csrfToken}
              expanded={expanded}
              snap={snap}
              onModalAction={setModalAction}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
            <MobileSyncChip
              ahead={ahead}
              behind={behind}
              hasUpstream={!!snap?.upstream}
            />
            <MobileLocalChip
              dirty={dirtyTotal}
              newFiles={newFiles}
              conflicts={conflicts}
            />
            {prCount > 0 && ghPrUrl && (
              <a
                href={ghPrUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
              >
                <GitPullRequest className="h-3.5 w-3.5" />
                <span className="tabular-nums">{prCount}</span>
              </a>
            )}
          </div>

          <div
            className="mono truncate text-[11px] text-fg-muted"
            title={snap?.lastCommitSubject ?? undefined}
          >
            {snap?.lastCommitSubject ?? "—"}
            <span className="ml-2 text-fg-dim">
              · {relativeTime(snap?.lastCommitTs ?? null)}
            </span>
          </div>

          {buttons.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {buttons.map((b) => (
                <button
                  key={b.action}
                  onClick={(e) => {
                    e.stopPropagation();
                    setModalAction(b.action);
                  }}
                  className={cn(actionButtonClass(kind, b.variant), "h-11 px-4 text-[13px] sm:h-10")}
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <RowDetail repoId={repo.id} open={expanded} />
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
}: {
  ahead: number;
  behind: number;
  hasUpstream: boolean;
}) {
  if (!hasUpstream) return <Pill tone="neutral">no upstream</Pill>;
  if (ahead === 0 && behind === 0) return <Pill tone="clean">in sync</Pill>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ahead > 0 && <Pill tone="push">{ahead} ahead</Pill>}
      {behind > 0 && <Pill tone="pull">{behind} behind</Pill>}
    </div>
  );
}

function LocalCell({
  dirty,
  newFiles,
  conflicts,
}: {
  dirty: number;
  newFiles: number;
  conflicts: number;
}) {
  if (conflicts > 0) {
    return <Pill tone="attention">{conflicts} conflict{conflicts === 1 ? "" : "s"}</Pill>;
  }
  if (dirty === 0) return <Pill tone="clean">clean</Pill>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Pill tone="dirty">{dirty} unsaved</Pill>
      {newFiles > 0 && <Pill tone="neutral">{newFiles} new</Pill>}
    </div>
  );
}

function MobileSyncChip({
  ahead,
  behind,
  hasUpstream,
}: {
  ahead: number;
  behind: number;
  hasUpstream: boolean;
}) {
  if (!hasUpstream) return <Pill tone="neutral">no upstream</Pill>;
  if (ahead === 0 && behind === 0) return <Pill tone="clean">in sync</Pill>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {ahead > 0 && <Pill tone="push">{ahead} ahead</Pill>}
      {behind > 0 && <Pill tone="pull">{behind} behind</Pill>}
    </span>
  );
}

function MobileLocalChip({
  dirty,
  newFiles,
  conflicts,
}: {
  dirty: number;
  newFiles: number;
  conflicts: number;
}) {
  if (conflicts > 0) {
    return <Pill tone="attention">{conflicts} conflict{conflicts === 1 ? "" : "s"}</Pill>;
  }
  if (dirty === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Pill tone="dirty">{dirty} unsaved</Pill>
      {newFiles > 0 && <Pill tone="neutral">{newFiles} new</Pill>}
    </span>
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
      onClick={(e) => e.stopPropagation()}
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
  expanded,
  snap,
  onModalAction,
}: {
  ghUrl: string | null;
  repoId: number;
  csrfToken: string;
  expanded: boolean;
  snap: import("@/lib/db/repos").SnapshotRow | null;
  onModalAction: (action: string) => void;
}) {
  const [refreshState, setRefreshState] = useState<"idle" | "spinning" | "error" | "rate-limited">("idle");

  const remoteCheckedAt = snap?.remoteCheckedAt ?? null;
  const remoteState = snap?.remoteState ?? null;

  // True when remote check is "unknown" and hasn't succeeded in the last 5 min.
  const isStuck =
    remoteState === "unknown" &&
    (remoteCheckedAt === null || Date.now() - remoteCheckedAt > 5 * 60 * 1000);

  function buildTooltip(): string {
    if (refreshState === "error") return "Refresh failed — see server logs";
    if (refreshState === "rate-limited") return "Checked recently — please wait a moment";

    let tip =
      remoteCheckedAt != null
        ? `Last remote check: ${relativeTime(remoteCheckedAt / 1000)}`
        : "Remote not yet checked";

    if (isStuck) {
      tip +=
        " · check has been failing\nPossible causes: branch removed on GitHub, auth expired, repo renamed/deleted.";
    }
    return tip;
  }

  const onRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (refreshState === "spinning" || refreshState === "rate-limited") return;
    setRefreshState("spinning");
    try {
      const res = await fetch(`/api/repos/${repoId}/refresh-remote`, {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      });
      if (res.status === 429) {
        setRefreshState("rate-limited");
        setTimeout(() => setRefreshState("idle"), 5_000);
      } else if (!res.ok) {
        setRefreshState("error");
        setTimeout(() => setRefreshState("idle"), 2_000);
      } else {
        setRefreshState("idle");
      }
    } catch {
      setRefreshState("error");
      setTimeout(() => setRefreshState("idle"), 2_000);
    }
  };

  return (
    <div className="flex items-center justify-end gap-0.5 sm:gap-1">
      {ghUrl && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onModalAction("wip-restore");
          }}
          title="Restore work-in-progress from another machine"
          aria-label="Restore WIP from another machine"
          className="inline-flex h-11 items-center justify-center rounded-full px-2 text-[11px] font-medium text-fg-dim transition-colors hover:bg-bg-hover hover:text-fg sm:h-7"
        >
          Restore WIP
        </button>
      )}
      <div className="relative flex items-center">
        {isStuck && refreshState === "idle" && (
          <span
            className="absolute -left-4 text-[11px] text-accent-attention"
            title="Remote check is stuck. Click refresh to retry."
            aria-label="Remote check is stuck"
          >
            ⚠
          </span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          title={buildTooltip()}
          aria-label="Refresh remote state"
          disabled={refreshState === "spinning" || refreshState === "rate-limited"}
          className={cn(
            "inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors sm:h-7 sm:w-7",
            refreshState === "error" && "text-accent-attention",
            refreshState === "rate-limited" && "text-fg-dim opacity-50 cursor-not-allowed",
            refreshState === "idle" && "text-fg hover:bg-bg-hover",
            refreshState === "spinning" && "cursor-wait text-fg",
          )}
        >
          <RefreshCw
            className={cn("h-4 w-4", refreshState === "spinning" && "animate-spin")}
          />
        </button>
      </div>
      {ghUrl ? (
        <a
          href={ghUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Open on GitHub"
          aria-label="Open on GitHub"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-dim transition-colors hover:bg-bg-hover hover:text-fg sm:h-7 sm:w-7"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : (
        <span
          className="inline-flex h-11 w-11 items-center justify-center text-fg-dim opacity-30 sm:h-7 sm:w-7"
          title="No GitHub remote"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </span>
      )}
      <span
        aria-hidden="true"
        className="inline-flex h-11 w-11 items-center justify-center text-fg-dim sm:h-7 sm:w-7"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </span>
    </div>
  );
}
