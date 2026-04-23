"use client";

import { useEffect, useRef, useState } from "react";
import type { RepoView } from "@/lib/state/store";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  repo: RepoView;
  action: string;
  csrfToken: string;
  onClose: () => void;
}

type Phase = "confirm" | "running" | "done" | "error";

const DESTRUCTIVE_CONFIRMATION_LIMIT = 10;

const COPY: Record<string, { verb: string; confirm?: string }> = {
  fetch: { verb: "Asking GitHub what's new" },
  pull: { verb: "Downloading new commits" },
  push: { verb: "Pushing your commits to GitHub" },
  merge: {
    verb: "Merging with GitHub",
    confirm:
      "This will combine GitHub's new commits with yours, creating a merge commit. Conflicts (if any) will be left in your working tree for you to resolve.",
  },
  "open-editor": { verb: "Opening in your editor" },
};

export function ActionModal({ repo, action, csrfToken, onClose }: Props) {
  const snap = repo.snapshot;
  const pushCount = snap?.remoteAhead ?? snap?.ahead ?? 0;
  const needsConfirm =
    action === "merge" || (action === "push" && pushCount > DESTRUCTIVE_CONFIRMATION_LIMIT);

  const [phase, setPhase] = useState<Phase>(needsConfirm ? "confirm" : "running");
  const [log, setLog] = useState<string[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (phase !== "running") return;
    let cancelled = false;

    async function run() {
      try {
        const res = await fetch(`/api/repos/${repo.id}/actions/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const text = await res.text();
          if (!cancelled) {
            setLog((l) => [...l, `HTTP ${res.status}: ${text}`]);
            setPhase("error");
          }
          return;
        }
        const payload = (await res.json()) as { runId: string };
        if (cancelled) return;

        const es = new EventSource(`/api/actions/${payload.runId}/stream`);
        esRef.current = es;
        es.addEventListener("line", (ev: MessageEvent) => {
          const data = JSON.parse(ev.data) as { text: string };
          setLog((l) => [...l, data.text]);
        });
        es.addEventListener("done", (ev: MessageEvent) => {
          const data = JSON.parse(ev.data) as { exitCode: number };
          setExitCode(data.exitCode);
          setPhase(data.exitCode === 0 ? "done" : "error");
          es.close();
        });
        es.addEventListener("error", () => {
          setPhase((p) => (p === "running" ? "error" : p));
          es.close();
        });
      } catch (err) {
        if (!cancelled) {
          setLog((l) => [...l, String(err)]);
          setPhase("error");
        }
      }
    }
    run();
    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, [phase, action, repo.id, csrfToken]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const copy = COPY[action] ?? { verb: action };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(80vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-6 py-5">
          <div className="min-w-0">
            <p className="text-[12px] uppercase tracking-wider text-fg-dim">{copy.verb}</p>
            <h2 className="display mt-1 text-[22px] leading-tight text-fg">{repo.displayName}</h2>
            {snap?.branch && (
              <p className="mono mt-1 text-[12px] text-fg-dim">on {snap.branch}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-bg-hover hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {phase === "confirm" && (
          <div className="flex flex-col gap-4 px-6 py-6">
            <p className="text-[14px] leading-relaxed text-fg-muted">
              {action === "merge"
                ? copy.confirm
                : `You're about to push ${pushCount} commit${pushCount === 1 ? "" : "s"} to GitHub. That's a lot — just making sure.`}
            </p>
            <div className="mt-2 flex justify-end gap-3">
              <button
                onClick={onClose}
                className="rounded-full border border-border px-4 py-1.5 text-[13px] font-medium text-fg-muted hover:border-fg-muted hover:text-fg"
              >
                Cancel
              </button>
              <button
                onClick={() => setPhase("running")}
                className={cn(
                  "rounded-full border px-5 py-1.5 text-[13px] font-medium transition-all",
                  action === "merge"
                    ? "border-accent-diverged/45 bg-accent-diverged/15 text-accent-diverged hover:bg-accent-diverged/25"
                    : "border-accent-push/45 bg-accent-push/15 text-accent-push hover:bg-accent-push/25",
                )}
              >
                {action === "merge" ? "Merge anyway" : "Push anyway"}
              </button>
            </div>
          </div>
        )}

        {phase !== "confirm" && (
          <pre
            ref={logRef}
            className="mono flex-1 overflow-auto whitespace-pre-wrap break-words border-b border-border-subtle bg-bg px-6 py-4 text-[12px] leading-relaxed text-fg-muted"
          >
            {log.length === 0 ? <span className="text-fg-dim">starting…</span> : log.join("\n")}
          </pre>
        )}

        {phase !== "confirm" && (
          <footer className="flex items-center justify-between px-6 py-3 text-[12px]">
            <div className={cn(
              "uppercase tracking-wider",
              phase === "running" && "text-fg-dim",
              phase === "done" && "text-accent-clean",
              phase === "error" && "text-accent-attention",
            )}>
              {phase === "running" && "running"}
              {phase === "done" && "done"}
              {phase === "error" && `error${exitCode !== null ? ` · exit ${exitCode}` : ""}`}
            </div>
            <button
              onClick={onClose}
              className="rounded-full border border-border px-3 py-1 text-fg-muted hover:border-fg-muted hover:text-fg"
            >
              Close
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
