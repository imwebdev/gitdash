"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RepoView } from "@/lib/state/store";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  "commit-push": { verb: "Committing and pushing to GitHub" },
  "open-editor": { verb: "Opening in your editor" },
  "open-terminal": { verb: "Opening a terminal" },
};

interface ChangeEntry {
  path: string;
  status: string;
  sizeBytes: number;
  reason: "secret" | "large" | null;
}

interface ChangesResponse {
  files: ChangeEntry[];
  total: number;
  suspicious: ChangeEntry[];
  truncated: boolean;
}

export function ActionModal({ repo, action, csrfToken, onClose }: Props) {
  const snap = repo.snapshot;
  const pushCount = snap?.remoteAhead ?? snap?.ahead ?? 0;
  const isCommitPush = action === "commit-push";
  const needsConfirm =
    isCommitPush ||
    action === "merge" ||
    (action === "push" && pushCount > DESTRUCTIVE_CONFIRMATION_LIMIT);

  const [phase, setPhase] = useState<Phase>(needsConfirm ? "confirm" : "running");
  const [log, setLog] = useState<string[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [commitMessage, setCommitMessage] = useState<string>("");
  const [changes, setChanges] = useState<ChangesResponse | null>(null);
  const [changesLoading, setChangesLoading] = useState(isCommitPush);
  const [mounted, setMounted] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = "action-modal-title";

  useEffect(() => {
    setMounted(true);
  }, []);

  // Focus trap, Escape, initial focus, restore focus on close
  useEffect(() => {
    if (!mounted) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const getFocusables = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled") && el.getAttribute("tabindex") !== "-1",
      );

    const initial = getFocusables()[0];
    if (initial) {
      initial.focus();
    } else {
      dialog.setAttribute("tabindex", "-1");
      dialog.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const tabbables = getFocusables();
      if (tabbables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = tabbables[0]!;
      const last = tabbables[tabbables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [mounted, onClose]);

  // Inert body siblings so assistive tech + pointer input stay inside the modal
  useEffect(() => {
    if (!mounted) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const toRestore: { el: HTMLElement; prev: string | null }[] = [];
    for (const child of Array.from(document.body.children) as HTMLElement[]) {
      if (child === dialog || child.contains(dialog)) continue;
      toRestore.push({ el: child, prev: child.getAttribute("inert") });
      child.setAttribute("inert", "");
    }
    return () => {
      for (const { el, prev } of toRestore) {
        if (prev === null) el.removeAttribute("inert");
        else el.setAttribute("inert", prev);
      }
    };
  }, [mounted]);

  // Fetch changes preview when entering commit-push confirm
  useEffect(() => {
    if (!isCommitPush || phase !== "confirm") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/repos/${repo.id}/changes`);
        if (res.ok && !cancelled) {
          setChanges((await res.json()) as ChangesResponse);
        }
      } catch {
        // best-effort; user can still commit blind
      } finally {
        if (!cancelled) setChangesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCommitPush, phase, repo.id]);

  useEffect(() => {
    if (phase !== "running") return;
    let cancelled = false;

    async function run() {
      try {
        const body = isCommitPush ? { commitMessage: commitMessage.trim() } : {};
        const res = await fetch(`/api/repos/${repo.id}/actions/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
          body: JSON.stringify(body),
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
  }, [phase, action, repo.id, csrfToken, isCommitPush, commitMessage]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const copy = COPY[action] ?? { verb: action };

  if (!mounted) return null;

  const dialog = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(85vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-6 py-5">
          <div className="min-w-0">
            <p className="text-[12px] uppercase tracking-wider text-fg-dim">{copy.verb}</p>
            <h2 id={titleId} className="display mt-1 text-[22px] leading-tight text-fg">
              {repo.displayName}
            </h2>
            {snap?.branch && (
              <p className="mono mt-1 text-[12px] text-fg-dim">on {snap.branch}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-bg-hover hover:text-fg sm:h-8 sm:w-8"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {phase === "confirm" && isCommitPush && (
          <CommitPushConfirm
            changes={changes}
            loading={changesLoading}
            commitMessage={commitMessage}
            onMessageChange={setCommitMessage}
            onCancel={onClose}
            onConfirm={() => setPhase("running")}
          />
        )}

        {phase === "confirm" && !isCommitPush && (
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

  return createPortal(dialog, document.body);
}

function CommitPushConfirm({
  changes,
  loading,
  commitMessage,
  onMessageChange,
  onCancel,
  onConfirm,
}: {
  changes: ChangesResponse | null;
  loading: boolean;
  commitMessage: string;
  onMessageChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const total = changes?.total ?? 0;
  const suspicious = changes?.suspicious ?? [];

  return (
    <div className="flex flex-col gap-5 overflow-y-auto px-6 py-6">
      {loading && (
        <p className="text-[13px] text-fg-dim">Looking at what changed…</p>
      )}

      {!loading && changes && total === 0 && (
        <p className="text-[13px] text-fg-muted">
          No changes detected. Nothing to commit.
        </p>
      )}

      {!loading && changes && total > 0 && (
        <>
          <div>
            <p className="text-[14px] text-fg">
              <span className="display-italic text-fg">{total}</span>{" "}
              file{total === 1 ? "" : "s"} will be committed and pushed to GitHub.
            </p>
            {changes.truncated && (
              <p className="mt-1 text-[11px] text-fg-dim">(showing first 500 — repo has more)</p>
            )}
            <FilePreview files={changes.files.slice(0, 8)} />
            {changes.files.length > 8 && (
              <p className="mt-2 text-[11px] text-fg-dim">…and {changes.files.length - 8} more</p>
            )}
          </div>

          {suspicious.length > 0 && (
            <div className="flex gap-3 rounded-lg border border-accent-attention/40 bg-accent-attention/8 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent-attention" />
              <div className="text-[12.5px] text-fg-muted">
                <p className="font-medium text-fg">
                  Heads up — gitdash flagged {suspicious.length} file{suspicious.length === 1 ? "" : "s"}:
                </p>
                <ul className="mt-1.5 space-y-0.5 mono text-[11.5px]">
                  {suspicious.slice(0, 6).map((f) => (
                    <li key={f.path} className="text-accent-attention">
                      {f.path}
                      <span className="ml-2 text-fg-dim">
                        ({f.reason === "secret" ? "looks like a secret" : "large file"})
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11.5px] text-fg-dim">
                  These will be pushed to GitHub publicly if your repo is public. Make sure that's what you want.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      <label className="flex flex-col gap-2">
        <span className="text-[12px] uppercase tracking-wider text-fg-dim">Commit message</span>
        <input
          type="text"
          value={commitMessage}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder="Update from this computer"
          maxLength={300}
          className="rounded-lg border border-border bg-bg/60 px-3.5 py-2 text-[13.5px] text-fg placeholder:text-fg-dim focus:border-ring focus:outline-none"
        />
        <span className="text-[11px] text-fg-dim">
          Leave blank to use the default. This is what shows up in your GitHub commit history.
        </span>
      </label>

      <div className="mt-1 flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="rounded-full border border-border px-4 py-1.5 text-[13px] font-medium text-fg-muted hover:border-fg-muted hover:text-fg"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={!loading && total === 0}
          className={cn(
            "rounded-full border px-5 py-1.5 text-[13px] font-medium transition-all",
            "border-accent-push/45 bg-accent-push/15 text-accent-push hover:bg-accent-push/25",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          Commit &amp; push
        </button>
      </div>
    </div>
  );
}

function FilePreview({ files }: { files: ChangeEntry[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="mt-3 mono space-y-0.5 text-[11.5px]">
      {files.map((f) => (
        <li key={f.path} className={cn("truncate", f.reason ? "text-accent-attention" : "text-fg-muted")}>
          <span className="text-fg-dim">{statusGlyph(f.status)}</span> {f.path}
        </li>
      ))}
    </ul>
  );
}

function statusGlyph(status: string): string {
  // git porcelain XY — show the more interesting side
  const s = status.trim();
  if (s.startsWith("??")) return "+";       // untracked
  if (s.includes("A")) return "+";          // added
  if (s.includes("D")) return "−";          // deleted
  if (s.includes("R")) return "→";          // renamed
  if (s.includes("M")) return "~";          // modified
  return "·";
}
