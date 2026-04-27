"use client";

import { useEffect, useRef, useState } from "react";

interface RepoInfo {
  id: number;
  name: string;
}

interface Props {
  bulkRunId: string;
  repos: RepoInfo[];
  onClose: () => void;
}

type RowPhase = "queued" | "pulling" | "done" | "failed";

interface RowState {
  phase: RowPhase;
  message?: string;
}

interface SummaryState {
  ok: number;
  failed: Array<{ name: string; message: string }>;
}

const TIMEOUT_MS = 60_000;

function PhasePill({ phase }: { phase: RowPhase }) {
  switch (phase) {
    case "queued":
      return (
        <span className="inline-flex items-center rounded-full bg-bg-elevated px-2 py-0.5 text-[11px] font-medium text-fg-dim">
          queued
        </span>
      );
    case "pulling":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-push/15 px-2 py-0.5 text-[11px] font-medium text-accent-push">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-push" />
          pulling…
        </span>
      );
    case "done":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-clean/15 px-2 py-0.5 text-[11px] font-medium text-accent-clean">
          done ✓
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-attention/15 px-2 py-0.5 text-[11px] font-medium text-accent-attention">
          failed ✗
        </span>
      );
  }
}

export function BulkActionModal({ bulkRunId, repos, onClose }: Props) {
  const [rowStates, setRowStates] = useState<Map<number, RowState>>(
    () => new Map(repos.map((r) => [r.id, { phase: "queued" }])),
  );
  const [summary, setSummary] = useState<SummaryState | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [showFailures, setShowFailures] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDone = summary !== null || timedOut;

  useEffect(() => {
    const es = new EventSource(`/api/bulk/${bulkRunId}/stream`);
    esRef.current = es;

    const update = (id: number, patch: Partial<RowState>) => {
      setRowStates((prev) => {
        const next = new Map(prev);
        next.set(id, { ...(prev.get(id) ?? { phase: "queued" }), ...patch });
        return next;
      });
    };

    es.addEventListener("start", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { repoId: number; name: string };
        update(data.repoId, { phase: "pulling" });
      } catch {
        // malformed frame — ignore, don't crash
      }
    });

    es.addEventListener("done", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { repoId: number };
        update(data.repoId, { phase: "done" });
      } catch {
        // ignore
      }
    });

    es.addEventListener("error", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { repoId: number; message: string };
        update(data.repoId, { phase: "failed", message: data.message });
      } catch {
        // ignore
      }
    });

    es.addEventListener("summary", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as SummaryState;
        setSummary(data);
      } catch {
        // ignore
      }
      es.close();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    });

    // Safety timeout: close and allow dismiss if stream stalls
    timeoutRef.current = setTimeout(() => {
      setTimedOut(true);
      es.close();
    }, TIMEOUT_MS);

    return () => {
      es.close();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [bulkRunId]);

  const rows = repos.map((r) => ({
    ...r,
    state: rowStates.get(r.id) ?? { phase: "queued" as RowPhase },
  }));

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (isDone && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-lg flex-col gap-5 rounded-2xl border border-border bg-bg p-6 shadow-2xl">
        <header className="flex items-center justify-between gap-4">
          <h2 className="display text-[20px] tracking-display-tight text-fg">
            Pull All
          </h2>
          {!isDone && (
            <span className="text-[12px] text-fg-dim">in progress…</span>
          )}
        </header>

        {/* Repo list */}
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-0.5 rounded-lg px-3 py-2 odd:bg-bg-elevated/40"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-[13px] text-fg">{r.name}</span>
                <PhasePill phase={r.state.phase} />
              </div>
              {r.state.phase === "failed" && r.state.message && (
                <p className="text-[11px] text-accent-attention">{r.state.message}</p>
              )}
            </li>
          ))}
        </ul>

        {/* Summary */}
        {summary && (
          <div className="rounded-xl border border-border bg-bg-elevated/60 p-4">
            <p className="text-[14px] font-medium text-fg">
              {summary.ok} of {repos.length} pulled successfully
            </p>
            {summary.failed.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowFailures((v) => !v)}
                  className="text-[12px] text-fg-muted underline-offset-2 hover:underline"
                >
                  {showFailures ? "Hide" : "Show"} {summary.failed.length} failure{summary.failed.length !== 1 ? "s" : ""}
                </button>
                {showFailures && (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {summary.failed.map((f, i) => (
                      <li key={i} className="text-[12px]">
                        <span className="font-medium text-fg">{f.name}</span>
                        {" — "}
                        <span className="text-accent-attention">{f.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {timedOut && !summary && (
          <p className="text-[13px] text-accent-attention">
            The pull timed out. Some repos may have updated — check the dashboard.
          </p>
        )}

        <footer className="flex justify-end">
          <button
            type="button"
            disabled={!isDone}
            onClick={onClose}
            className="rounded-full bg-accent-pull px-5 py-2 text-[13px] font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40 hover:opacity-90"
          >
            {isDone ? "Done" : "Running…"}
          </button>
        </footer>
      </div>
    </div>
  );
}
