"use client";

import { useEffect, useRef, useState } from "react";
import type { RepoView } from "@/lib/state/store";
import { AlertTriangle, Ban, Lock, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  repo: RepoView;
  action: string;
  csrfToken: string;
  onClose: () => void;
}

type Phase = "blocked" | "confirm" | "running" | "done" | "error";

type BlockedReason =
  | { kind: "no-push-access" }
  | { kind: "oversized-files"; files: ChangeEntry[] };

const PUSH_ACTIONS = new Set(["push", "commit-push", "merge"]);

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
  reason: "secret" | "large" | "oversized" | null;
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

  // Preflight: block push-y actions outright when the user has no push access.
  // canPush === false is confidently blocked; null means unknown (not yet
  // checked, non-GitHub remote) so we let it proceed and learn from the remote.
  const noPushAccess =
    PUSH_ACTIONS.has(action) && snap?.canPush === false;

  const [blocked, setBlocked] = useState<BlockedReason | null>(
    noPushAccess ? { kind: "no-push-access" } : null,
  );
  const [phase, setPhase] = useState<Phase>(
    noPushAccess ? "blocked" : needsConfirm ? "confirm" : "running",
  );
  const [errorSummary, setErrorSummary] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [commitMessage, setCommitMessage] = useState<string>("");
  const [changes, setChanges] = useState<ChangesResponse | null>(null);
  const [changesLoading, setChangesLoading] = useState(isCommitPush);
  const logRef = useRef<HTMLPreElement | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Fetch changes preview when entering commit-push confirm
  useEffect(() => {
    if (!isCommitPush || phase !== "confirm") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/repos/${repo.id}/changes`);
        if (res.ok && !cancelled) {
          const data = (await res.json()) as ChangesResponse;
          setChanges(data);
          // Hard-block if any file exceeds GitHub's 100 MB size limit — the
          // push would be rejected by pre-receive and leave the user with a
          // local commit they have to undo.
          const oversized = data.files.filter((f) => f.reason === "oversized");
          if (oversized.length > 0) {
            setBlocked({ kind: "oversized-files", files: oversized });
            setPhase("blocked");
          }
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

  // When we land in the error state, translate the raw log into a single
  // actionable sentence so the user doesn't have to read a wall of stderr.
  useEffect(() => {
    if (phase !== "error") return;
    setErrorSummary(parseErrorSummary(log, exitCode));
  }, [phase, log, exitCode]);

  const copy = COPY[action] ?? { verb: action };

  return (
    <div
      role="dialog"
      aria-modal="true"
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
            <h2 className="display mt-1 text-[22px] leading-tight text-fg">{repo.displayName}</h2>
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

        {phase === "blocked" && blocked && (
          <BlockedCard
            reason={blocked}
            repoDisplay={repo.displayName}
            onClose={onClose}
          />
        )}

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

        {(phase === "running" || phase === "done" || phase === "error") && (
          <>
            {phase === "error" && errorSummary && (
              <div className="flex gap-3 border-b border-border-subtle bg-accent-diverged/8 px-6 py-3">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-accent-diverged"
                  aria-hidden="true"
                />
                <p className="text-[13px] leading-relaxed text-fg">{errorSummary}</p>
              </div>
            )}
            <pre
              ref={logRef}
              className="mono flex-1 overflow-auto whitespace-pre-wrap break-words border-b border-border-subtle bg-bg px-6 py-4 text-[12px] leading-relaxed text-fg-muted"
            >
              {log.length === 0 ? <span className="text-fg-dim">starting…</span> : log.join("\n")}
            </pre>
          </>
        )}

        {(phase === "running" || phase === "done" || phase === "error") && (
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

function parseErrorSummary(log: string[], exitCode: number | null): string | null {
  const text = log.join("\n");
  const perFile = text.match(
    /File (\S+) is ([\d.]+) MB; this exceeds GitHub's file size limit/,
  );
  if (perFile) {
    return `${perFile[1]} (${perFile[2]} MB) is over GitHub's 100 MB file-size limit. Remove it from the commit or use Git LFS.`;
  }
  if (/exceeds GitHub's file size limit/i.test(text)) {
    return "One or more files exceed GitHub's 100 MB file-size limit. Remove them from the commit or use Git LFS.";
  }
  if (/Permission denied \(publickey\)/i.test(text)) {
    return "SSH key was rejected. Run `gh auth setup-git` to route GitHub through HTTPS + your gh token, or add your SSH key to github.com/settings/keys.";
  }
  if (/non-fast-forward/i.test(text) || /tip of your current branch is behind/i.test(text)) {
    return "Your branch is behind the remote. Pull first, then push.";
  }
  if (/\[rejected\]/i.test(text) && /protected branch/i.test(text)) {
    return "Branch is protected. Push to a feature branch and open a PR instead.";
  }
  if (/pre-receive hook declined/i.test(text)) {
    return "GitHub rejected the push at a server-side hook. See the log below for the specific rule.";
  }
  if (/Could not resolve hostname/i.test(text) || /Network is unreachable/i.test(text)) {
    return "Can't reach the remote host. Check your network.";
  }
  if (/Authentication failed/i.test(text) || /could not read Username/i.test(text)) {
    return "GitHub authentication failed. Run `gh auth login` and `gh auth setup-git`.";
  }
  if (/CONFLICT/.test(text)) {
    return "Merge conflict. Open the repo, resolve the conflicts, then commit and push.";
  }
  if (exitCode !== null && exitCode !== 0) {
    return `Action exited with code ${exitCode}. See log below for details.`;
  }
  return null;
}

function BlockedCard({
  reason,
  repoDisplay,
  onClose,
}: {
  reason: BlockedReason;
  repoDisplay: string;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <div className="flex gap-3 rounded-lg border border-accent-diverged/40 bg-accent-diverged/10 p-4">
        {reason.kind === "no-push-access" ? (
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent-diverged" aria-hidden="true" />
        ) : (
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-accent-diverged" aria-hidden="true" />
        )}
        <div className="text-[13px] text-fg-muted">
          {reason.kind === "no-push-access" && (
            <>
              <p className="font-medium text-fg">No push access to {repoDisplay}</p>
              <p className="mt-2 leading-relaxed">
                Your GitHub token doesn&apos;t have push permission on this repo, so this
                action would be rejected by the server. gitdash is stopping it here so
                you don&apos;t end up with a failed-push state to clean up.
              </p>
              <p className="mt-2 leading-relaxed">
                If you think you should have access, check{" "}
                <span className="mono">gh auth status</span> and your role on the repo
                in github.com settings.
              </p>
            </>
          )}
          {reason.kind === "oversized-files" && (
            <>
              <p className="font-medium text-fg">
                {reason.files.length === 1
                  ? "A file exceeds GitHub's 100 MB limit"
                  : `${reason.files.length} files exceed GitHub's 100 MB limit`}
              </p>
              <p className="mt-2 leading-relaxed">
                GitHub blocks any single file over 100 MB at push time. Committing and
                pushing from gitdash would leave you with a commit you&apos;d have to
                undo. Remove these from the working tree (or put them in{" "}
                <span className="mono">.gitignore</span>), or use Git LFS.
              </p>
              <ul className="mt-2 space-y-0.5 mono text-[11.5px]">
                {reason.files.slice(0, 6).map((f) => (
                  <li key={f.path} className="text-accent-diverged">
                    {f.path}
                    <span className="ml-2 text-fg-dim">
                      ({(f.sizeBytes / (1024 * 1024)).toFixed(1)} MB)
                    </span>
                  </li>
                ))}
                {reason.files.length > 6 && (
                  <li className="text-fg-dim">…and {reason.files.length - 6} more</li>
                )}
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onClose}
          className="rounded-full border border-border px-4 py-1.5 text-[13px] font-medium text-fg-muted hover:border-fg-muted hover:text-fg"
        >
          Close
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
