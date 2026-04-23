"use client";

import { useEffect, useRef, useState } from "react";
import type { RepoView } from "@/lib/state/store";
import { X } from "lucide-react";

interface Props {
  repo: RepoView;
  action: string;
  csrfToken: string;
  onClose: () => void;
}

type Phase = "confirm" | "running" | "done" | "error";

const DESTRUCTIVE_CONFIRMATION_LIMIT = 10;

export function ActionModal({ repo, action, csrfToken, onClose }: Props) {
  const snap = repo.snapshot;
  const needsConfirm =
    action === "merge" ||
    (action === "push" && (snap?.remoteAhead ?? snap?.ahead ?? 0) > DESTRUCTIVE_CONFIRMATION_LIMIT);

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(80vh,700px)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              git {action}
            </div>
            <div className="truncate text-sm font-medium">{repo.repoPath}</div>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted/50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {phase === "confirm" && (
          <div className="flex flex-col gap-3 p-4 text-sm">
            <p className="text-muted-foreground">
              {action === "merge"
                ? `Merge origin/${snap?.branch ?? "<branch>"} into current branch with a merge commit (--no-ff). Conflicts will be left in the worktree for you to resolve.`
                : `Push ${snap?.remoteAhead ?? snap?.ahead} commits to origin/${snap?.branch ?? "<branch>"}. Continue?`}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted/50">
                Cancel
              </button>
              <button
                onClick={() => setPhase("running")}
                className="rounded bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90"
              >
                Run
              </button>
            </div>
          </div>
        )}

        {phase !== "confirm" && (
          <pre
            ref={logRef}
            className="flex-1 overflow-auto whitespace-pre-wrap break-words bg-background p-4 text-xs leading-relaxed"
          >
            {log.length === 0 ? <span className="text-muted-foreground">starting…</span> : log.join("\n")}
          </pre>
        )}

        {phase !== "confirm" && (
          <footer className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
            <div>
              {phase === "running" && "running…"}
              {phase === "done" && "done (exit 0)"}
              {phase === "error" && `error${exitCode !== null ? ` (exit ${exitCode})` : ""}`}
            </div>
            <button onClick={onClose} className="rounded border border-border px-2 py-1 hover:bg-muted/50">
              Close
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
