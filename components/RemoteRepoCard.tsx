"use client";

import { useState } from "react";
import { Download, ExternalLink, Lock, GitFork, Archive } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RemoteRepoView {
  slug: string;
  owner: string;
  name: string;
  description: string | null;
  pushedAt: string | null;
  isFork: boolean;
  isArchived: boolean;
  isPrivate: boolean;
  url: string;
}

interface Props {
  repo: RemoteRepoView;
  cloneDir: string;
  csrfToken: string;
  onCloned?: (slug: string) => void;
}

function relativeTimeIso(iso: string | null): string {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const deltaSec = Math.floor((Date.now() - ts) / 1000);
  if (deltaSec < 60) return "just now";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  if (deltaSec < 86400 * 30) return `${Math.floor(deltaSec / 86400)}d ago`;
  if (deltaSec < 86400 * 365)
    return `${Math.floor(deltaSec / (86400 * 30))}mo ago`;
  return `${Math.floor(deltaSec / (86400 * 365))}y ago`;
}

export function RemoteRepoCard({
  repo,
  cloneDir,
  csrfToken,
  onCloned,
}: Props) {
  const [status, setStatus] = useState<
    "idle" | "cloning" | "done" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onClone = async () => {
    if (status === "cloning") return;
    setStatus("cloning");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/github/clone", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ owner: repo.owner, name: repo.name }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          output?: string;
          hint?: string;
        };
        const msg =
          payload.error ?? `clone failed (HTTP ${res.status})`;
        const hint = payload.hint ? ` — ${payload.hint}` : "";
        const tail = payload.output
          ? `\n${payload.output.split("\n").slice(-4).join("\n")}`
          : "";
        setErrorMessage(`${msg}${hint}${tail}`);
        setStatus("error");
        return;
      }
      setStatus("done");
      onCloned?.(repo.slug);
    } catch (err) {
      setErrorMessage((err as Error).message ?? String(err));
      setStatus("error");
    }
  };

  return (
    <article className="flex flex-col gap-2 rounded-xl border border-border bg-bg-elevated/40 p-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <a
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate font-medium text-fg hover:underline"
            title={repo.slug}
          >
            {repo.slug}
          </a>
          {repo.isPrivate && (
            <Lock
              className="h-3.5 w-3.5 text-fg-dim"
              aria-label="private"
            />
          )}
          {repo.isFork && (
            <GitFork
              className="h-3.5 w-3.5 text-fg-dim"
              aria-label="fork"
            />
          )}
          {repo.isArchived && (
            <Archive
              className="h-3.5 w-3.5 text-fg-dim"
              aria-label="archived"
            />
          )}
        </div>
        {repo.description && (
          <p className="mt-1 line-clamp-1 text-[13px] text-fg-muted">
            {repo.description}
          </p>
        )}
        <p className="mt-1 text-[11px] text-fg-dim">
          last push {relativeTimeIso(repo.pushedAt)} · clones into{" "}
          <span className="mono">
            {cloneDir}/{repo.name}
          </span>
        </p>
        {errorMessage && (
          <pre className="mono mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-bg-elevated/80 p-2 text-[11px] text-accent-attention">
            {errorMessage}
          </pre>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <a
          href={repo.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open on GitHub"
          className="rounded-full border border-border p-1.5 text-fg-muted transition-colors hover:text-fg"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button
          type="button"
          onClick={onClone}
          disabled={status === "cloning" || status === "done"}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1 text-[12px] font-medium tracking-tight transition-all",
            status === "done"
              ? "border-accent-clean/40 bg-accent-clean/10 text-accent-clean"
              : status === "error"
                ? "border-accent-attention/40 bg-accent-attention/10 text-accent-attention hover:bg-accent-attention/20"
                : "border-accent-pull/40 bg-accent-pull/10 text-accent-pull hover:bg-accent-pull/20 disabled:opacity-50",
          )}
        >
          {status === "cloning" && "Cloning…"}
          {status === "idle" && (
            <span className="flex items-center gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Clone here
            </span>
          )}
          {status === "done" && "Cloned ✓"}
          {status === "error" && "Retry"}
        </button>
      </div>
    </article>
  );
}
