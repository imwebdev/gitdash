"use client";

import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import type { RepoView } from "@/lib/state/store";
import { useState } from "react";
import { ActionModal } from "./ActionModal";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  GitMerge,
  RefreshCw,
  Archive,
  ArrowUpRightFromSquare,
  FolderOpen,
} from "lucide-react";

interface Props {
  repo: RepoView;
  csrfToken: string;
}

function relativeTime(unix: number | null | undefined): string {
  if (!unix) return "—";
  const deltaSec = Math.floor(Date.now() / 1000 - unix);
  if (deltaSec < 60) return `${deltaSec}s`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h`;
  if (deltaSec < 86400 * 30) return `${Math.floor(deltaSec / 86400)}d`;
  if (deltaSec < 86400 * 365) return `${Math.floor(deltaSec / (86400 * 30))}mo`;
  return `${Math.floor(deltaSec / (86400 * 365))}y`;
}

export function RepoRow({ repo, csrfToken }: Props) {
  const [action, setAction] = useState<string | null>(null);
  const snap = repo.snapshot;
  const weird = (snap?.weirdFlags.length ?? 0) > 0;
  const dirty = snap ? snap.dirtyTracked + snap.staged + snap.untracked + snap.conflicted : 0;

  return (
    <>
      <div
        className={cn(
          "group grid grid-cols-[minmax(180px,1fr)_100px_120px_80px_110px_minmax(460px,auto)] items-center gap-3 border-b border-border px-4 py-2.5 text-sm hover:bg-muted/20",
          weird && "weird-stripes",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <StatusBadge state={repo.derivedState} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 truncate">
              <span className="truncate font-medium text-foreground">{repo.displayName}</span>
              {snap?.branch && (
                <span className="truncate text-xs text-muted-foreground">
                  {snap.detached ? "HEAD detached" : snap.branch}
                </span>
              )}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">{repo.repoPath}</div>
          </div>
        </div>

        <div className="text-xs tabular-nums">
          {snap?.remoteState === "ahead" || snap?.remoteState === "diverged" ? (
            <span className="text-status-ahead">↑{snap.remoteAhead ?? snap.ahead}</span>
          ) : null}
          {snap?.remoteState && snap.remoteState !== "clean" && snap.remoteState !== "no-upstream" && (
            <span className="mx-1 text-muted-foreground">·</span>
          )}
          {snap?.remoteState === "behind" || snap?.remoteState === "diverged" ? (
            <span className="text-status-behind">↓{snap.remoteBehind ?? snap.behind}</span>
          ) : null}
          {!snap?.remoteState && snap && (snap.ahead > 0 || snap.behind > 0) && (
            <>
              {snap.ahead > 0 && <span className="text-status-ahead">↑{snap.ahead}</span>}
              {snap.ahead > 0 && snap.behind > 0 && <span className="mx-1 text-muted-foreground">·</span>}
              {snap.behind > 0 && <span className="text-status-behind">↓{snap.behind}</span>}
            </>
          )}
          {snap && snap.ahead === 0 && snap.behind === 0 && !snap.remoteState && (
            <span className="text-muted-foreground">—</span>
          )}
        </div>

        <div
          className="text-xs tabular-nums"
          title={
            dirty > 0
              ? `${dirty} file(s) changed but not committed yet${snap?.untracked ? `. ${snap.untracked} of those are brand-new (untracked) files.` : ""}`
              : "no uncommitted changes"
          }
        >
          {dirty > 0 ? (
            <span className="text-status-dirty">
              {dirty} file{dirty === 1 ? "" : "s"}
              {snap?.untracked ? ` (${snap.untracked} new)` : ""}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>

        <div
          className="text-xs tabular-nums text-muted-foreground"
          title={snap?.lastCommitSubject ?? ""}
        >
          {relativeTime(snap?.lastCommitTs)}
        </div>

        <div className="truncate text-xs text-muted-foreground">
          {repo.githubOwner && repo.githubName ? `${repo.githubOwner}/${repo.githubName}` : "—"}
        </div>

        <div className="flex items-center justify-end gap-1 overflow-x-auto">
          <LabeledButton
            icon={<RefreshCw className="h-3 w-3" />}
            label="Fetch"
            tooltip="Ask GitHub what's new without changing any of your files. Safe anytime."
            onClick={() => setAction("fetch")}
          />
          <LabeledButton
            icon={<ArrowDownToLine className="h-3 w-3" />}
            label="Pull"
            tooltip="Download new commits from GitHub. Only works if your history isn't diverged."
            onClick={() => setAction("pull")}
          />
          <LabeledButton
            icon={<ArrowUpFromLine className="h-3 w-3" />}
            label="Push"
            tooltip="Upload your local commits to GitHub."
            onClick={() => setAction("push")}
          />
          <LabeledButton
            icon={<GitMerge className="h-3 w-3" />}
            label="Merge"
            tooltip="Combine GitHub's new commits with yours when history has diverged. Asks to confirm first."
            onClick={() => setAction("merge")}
          />
          <LabeledButton
            icon={<Archive className="h-3 w-3" />}
            label="Stash"
            tooltip="Temporarily set aside your uncommitted changes (git stash) so you can Pull cleanly."
            onClick={() => setAction("stash-push")}
          />
          {repo.githubOwner && (
            <a
              className="inline-flex h-6 items-center gap-1 rounded border border-border bg-muted/20 px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              title="Open this repo's page on github.com"
              href={`https://github.com/${repo.githubOwner}/${repo.githubName}`}
              target="_blank"
              rel="noreferrer"
            >
              <ArrowUpRightFromSquare className="h-3 w-3" />
              GitHub
            </a>
          )}
          <LabeledButton
            icon={<FolderOpen className="h-3 w-3" />}
            label="Editor"
            tooltip="Open this folder in VS Code (or whatever your $EDITOR is)."
            onClick={() => setAction("open-editor")}
          />
        </div>
      </div>

      {action && (
        <ActionModal
          repo={repo}
          action={action}
          csrfToken={csrfToken}
          onClose={() => setAction(null)}
        />
      )}
    </>
  );
}

function LabeledButton({
  icon,
  label,
  tooltip,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <button
      title={tooltip}
      onClick={onClick}
      className="inline-flex h-6 items-center gap-1 rounded border border-border bg-muted/20 px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-muted/50 hover:text-foreground"
    >
      {icon}
      {label}
    </button>
  );
}
