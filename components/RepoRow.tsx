"use client";

import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import type { RepoView } from "@/lib/state/store";
import { useState } from "react";
import { ActionModal } from "./ActionModal";
import { ArrowDownToLine, ArrowUpFromLine, GitMerge, RefreshCw, Archive, ArrowUpRightFromSquare, FolderOpen } from "lucide-react";

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
          "group grid grid-cols-[minmax(220px,1fr)_120px_90px_90px_110px_auto] items-center gap-3 border-b border-border px-4 py-2.5 text-sm hover:bg-muted/20",
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

        <div className="text-xs tabular-nums">
          {dirty > 0 ? (
            <span className="text-status-dirty">
              {dirty}
              {snap?.untracked ? ` (${snap.untracked}?)` : ""}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>

        <div className="text-xs tabular-nums text-muted-foreground">
          {relativeTime(snap?.lastCommitTs)}
        </div>

        <div className="truncate text-xs text-muted-foreground">
          {repo.githubOwner && repo.githubName ? `${repo.githubOwner}/${repo.githubName}` : "—"}
        </div>

        <div className="flex items-center gap-1 opacity-70 transition group-hover:opacity-100">
          <ActionButton title="Fetch" onClick={() => setAction("fetch")}>
            <RefreshCw className="h-3.5 w-3.5" />
          </ActionButton>
          <ActionButton title="Pull (ff-only)" onClick={() => setAction("pull")}>
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </ActionButton>
          <ActionButton title="Push" onClick={() => setAction("push")}>
            <ArrowUpFromLine className="h-3.5 w-3.5" />
          </ActionButton>
          <ActionButton title="Merge (--no-ff)" onClick={() => setAction("merge")}>
            <GitMerge className="h-3.5 w-3.5" />
          </ActionButton>
          <ActionButton title="Stash push" onClick={() => setAction("stash-push")}>
            <Archive className="h-3.5 w-3.5" />
          </ActionButton>
          {repo.githubOwner && (
            <a
              className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted/50"
              title="Open on GitHub"
              href={`https://github.com/${repo.githubOwner}/${repo.githubName}`}
              target="_blank"
              rel="noreferrer"
            >
              <ArrowUpRightFromSquare className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            title="Open in editor"
            onClick={() => setAction("open-editor")}
            className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted/50"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
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

function ActionButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground"
    >
      {children}
    </button>
  );
}
