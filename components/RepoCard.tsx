"use client";

import { cn } from "@/lib/utils";
import type { RepoView } from "@/lib/state/store";
import { ActionModal } from "./ActionModal";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  FileCode2,
  GitPullRequest,
  MoreHorizontal,
  RefreshCw,
  TerminalSquare,
} from "lucide-react";

export type GroupKind = "push" | "pull" | "diverged" | "attention" | "dirty" | "clean";

export const ROW_GRID =
  "grid-cols-[minmax(180px,1.4fr)_120px_150px_minmax(200px,1.6fr)_80px_148px_36px]";

function primaryAction(
  kind: GroupKind,
  hasRemote: boolean,
  hasConflicts: boolean,
): { label: string; action: string | null } {
  if (kind === "push") return { label: "Push", action: "push" };
  if (kind === "pull") return { label: "Pull", action: "pull" };
  if (kind === "diverged") return { label: "Merge", action: "merge" };
  if (kind === "attention") return { label: "Open", action: "open-editor" };
  if (kind === "dirty") {
    if (hasConflicts) return { label: "Resolve", action: "open-editor" };
    if (hasRemote) return { label: "Commit & push", action: "commit-push" };
    return { label: "Open", action: "open-editor" };
  }
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
        {/* Repo name + branch */}
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

        {/* Sync ↑n ↓n */}
        <SyncCell ahead={ahead} behind={behind} hasUpstream={!!snap?.upstream} kind={kind} />

        {/* Local changes */}
        <LocalCell
          dirty={dirtyTotal}
          newFiles={newFiles}
          conflicts={conflicts}
          kind={kind}
        />

        {/* Last commit subject + time */}
        <LastCommitCell
          subject={snap?.lastCommitSubject ?? null}
          ts={snap?.lastCommitTs ?? null}
        />

        {/* PRs */}
        <PrCell count={snap?.openPrCount ?? 0} url={ghPrUrl} />

        {/* Primary action */}
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
              kind === "attention" &&
                "border-accent-attention/35 bg-accent-attention/10 text-accent-attention hover:border-accent-attention/55 hover:bg-accent-attention/20",
              kind === "dirty" &&
                "border-accent-dirty/35 bg-accent-dirty/10 text-accent-dirty hover:border-accent-dirty/55 hover:bg-accent-dirty/20",
            )}
          >
            {button.label}
          </button>
        ) : (
          <span />
        )}

        {/* ⋯ menu */}
        <RowMenu
          ghUrl={ghUrl}
          remoteUrl={snap?.remoteUrl ?? null}
          onModalAction={(a) => setModalAction(a)}
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

interface RowMenuProps {
  ghUrl: string | null;
  remoteUrl: string | null;
  onModalAction: (action: string) => void;
}

function RowMenu({ ghUrl, remoteUrl, onModalAction }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copyClone = async () => {
    if (!remoteUrl) return;
    try {
      await navigator.clipboard.writeText(remoteUrl);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1200);
    } catch {
      // ignore — clipboard requires secure context; localhost is fine
    }
  };

  return (
    <div ref={containerRef} className="relative justify-self-end">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-fg-dim opacity-0 transition-all hover:bg-bg-hover hover:text-fg group-hover:opacity-100 data-[open=true]:opacity-100"
        data-open={open}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-2xl"
        >
          <MenuItem
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            label="Fetch from GitHub"
            onClick={() => {
              setOpen(false);
              onModalAction("fetch");
            }}
          />
          <MenuItem
            icon={<FileCode2 className="h-3.5 w-3.5" />}
            label="Open in editor"
            onClick={() => {
              setOpen(false);
              onModalAction("open-editor");
            }}
          />
          <MenuItem
            icon={<TerminalSquare className="h-3.5 w-3.5" />}
            label="Open in terminal"
            onClick={() => {
              setOpen(false);
              onModalAction("open-terminal");
            }}
          />
          <div className="my-1 h-px bg-border-subtle" />
          <MenuItem
            icon={<ExternalLink className="h-3.5 w-3.5" />}
            label="Open on GitHub"
            disabled={!ghUrl}
            onClick={() => {
              if (!ghUrl) return;
              window.open(ghUrl, "_blank", "noopener,noreferrer");
              setOpen(false);
            }}
          />
          <MenuItem
            icon={copied ? <Check className="h-3.5 w-3.5 text-accent-clean" /> : <Copy className="h-3.5 w-3.5" />}
            label={copied ? "Copied!" : "Copy clone URL"}
            disabled={!remoteUrl}
            onClick={copyClone}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] text-fg-muted transition-colors",
        disabled
          ? "cursor-not-allowed opacity-40"
          : "hover:bg-bg-hover hover:text-fg",
      )}
    >
      <span className="text-fg-dim">{icon}</span>
      {label}
    </button>
  );
}
