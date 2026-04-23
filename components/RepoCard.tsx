"use client";

import { cn } from "@/lib/utils";
import type { RepoView } from "@/lib/state/store";
import { ActionModal } from "./ActionModal";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";

export type GroupKind = "push" | "pull" | "diverged" | "attention" | "dirty" | "clean";

const ACCENT: Record<GroupKind, string> = {
  push: "text-accent-push",
  pull: "text-accent-pull",
  diverged: "text-accent-diverged",
  attention: "text-accent-attention",
  dirty: "text-accent-dirty",
  clean: "text-accent-clean",
};

const ACTION_BUTTON: Record<GroupKind, { label: string; action: string | null }> = {
  push: { label: "Push to GitHub", action: "push" },
  pull: { label: "Download now", action: "pull" },
  diverged: { label: "Merge", action: "merge" },
  attention: { label: "Open in editor", action: "open-editor" },
  dirty: { label: "Open folder", action: "open-editor" },
  clean: { label: "", action: null },
};

function relativeTime(unix: number | null | undefined): string {
  if (!unix) return "unknown";
  const deltaSec = Math.floor(Date.now() / 1000 - unix);
  if (deltaSec < 60) return "just now";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  if (deltaSec < 86400 * 30) return `${Math.floor(deltaSec / 86400)}d ago`;
  if (deltaSec < 86400 * 365) return `${Math.floor(deltaSec / (86400 * 30))}mo ago`;
  return `${Math.floor(deltaSec / (86400 * 365))}y ago`;
}

function statusLine(kind: GroupKind, repo: RepoView): string {
  const snap = repo.snapshot;
  const lastEdit = relativeTime(snap?.lastCommitTs);
  const ahead = Math.max(snap?.ahead ?? 0, snap?.remoteAhead ?? 0);
  const behind = Math.max(snap?.behind ?? 0, snap?.remoteBehind ?? 0);
  if (kind === "push") {
    return `${ahead} commit${ahead === 1 ? "" : "s"} waiting · last edit ${lastEdit}`;
  }
  if (kind === "pull") {
    return `${behind} commit${behind === 1 ? "" : "s"} behind github`;
  }
  if (kind === "diverged") {
    return `${ahead} ahead · ${behind} behind · history split`;
  }
  if (kind === "attention") {
    const flags = snap?.weirdFlags ?? [];
    if (flags.length > 0) return flags.join(", ").replaceAll("-", " ");
    if (snap?.detached) return "HEAD is detached";
    return "unusual state";
  }
  if (kind === "dirty") {
    const dirty = snap ? snap.dirtyTracked + snap.staged + snap.untracked + snap.conflicted : 0;
    const newFiles = snap?.untracked ?? 0;
    const newPart = newFiles > 0 ? ` (${newFiles} brand new)` : "";
    return `${dirty} unsaved file${dirty === 1 ? "" : "s"}${newPart} · last commit ${lastEdit}`;
  }
  return `synced · last edit ${lastEdit}`;
}

interface Props {
  repo: RepoView;
  kind: GroupKind;
  csrfToken: string;
}

export function RepoCard({ repo, kind, csrfToken }: Props) {
  const [modalAction, setModalAction] = useState<string | null>(null);
  const snap = repo.snapshot;
  const button = ACTION_BUTTON[kind];
  const ghUrl =
    repo.githubOwner && repo.githubName
      ? `https://github.com/${repo.githubOwner}/${repo.githubName}`
      : null;

  return (
    <>
      <div className="group relative flex items-center gap-5 px-6 py-4 transition-colors hover:bg-bg-hover/60">
        {/* Left accent stripe — tiny visual anchor, not loud */}
        <div
          aria-hidden
          className={cn(
            "absolute left-0 top-1/2 h-10 w-[2px] -translate-y-1/2 rounded-full opacity-50",
            kind === "push" && "bg-accent-push",
            kind === "pull" && "bg-accent-pull",
            kind === "diverged" && "bg-accent-diverged",
            kind === "attention" && "bg-accent-attention",
            kind === "dirty" && "bg-accent-dirty",
            kind === "clean" && "bg-accent-clean",
          )}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline gap-3">
            <h3 className="truncate text-[15px] font-medium tracking-tight text-fg">
              {repo.displayName}
            </h3>
            {snap?.branch && (
              <span className="mono truncate text-xs text-fg-dim">
                {snap.detached ? "(detached)" : snap.branch}
              </span>
            )}
            {ghUrl && (
              <a
                href={ghUrl}
                target="_blank"
                rel="noreferrer"
                className="text-fg-dim opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
                title="Open on GitHub"
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <p className="truncate text-[13px] text-fg-muted">
            <span className={cn("font-medium", ACCENT[kind])}>●</span>{" "}
            {statusLine(kind, repo)}
          </p>
        </div>

        {button.action && (
          <button
            onClick={() => setModalAction(button.action)}
            className={cn(
              "shrink-0 rounded-full border px-4 py-1.5 text-[13px] font-medium tracking-tight transition-all",
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
        )}
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
