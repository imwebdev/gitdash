"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Check, ExternalLink, Github, Loader2 } from "lucide-react";

interface Props {
  csrfToken: string;
  onClose: () => void;
  onSuccess: (login: string) => void;
}

type Phase =
  | { kind: "starting" }
  | {
      kind: "waiting";
      runId: string;
      deviceCode: string;
      verificationUri: string;
    }
  | { kind: "success"; login: string }
  | { kind: "failed"; error: string };

export function GhSignInModal({ csrfToken, onClose, onSuccess }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [copied, setCopied] = useState(false);
  const startedRef = useRef(false);

  // Kick off the auth flow when the modal mounts (once).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      try {
        const res = await fetch("/api/github/auth/login", {
          method: "POST",
          headers: { "x-csrf-token": csrfToken },
        });
        const data = await res.json();
        if (!res.ok) {
          setPhase({
            kind: "failed",
            error: data.detail || data.error || "Sign-in failed",
          });
          return;
        }
        if (data.alreadyAuthenticated) {
          setPhase({ kind: "success", login: data.login });
          onSuccess(data.login);
          return;
        }
        setPhase({
          kind: "waiting",
          runId: data.runId,
          deviceCode: data.deviceCode,
          verificationUri: data.verificationUri,
        });
      } catch (err) {
        setPhase({ kind: "failed", error: (err as Error).message });
      }
    })();
  }, [csrfToken, onSuccess]);

  // Poll for completion while in the "waiting" phase.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    let cancelled = false;
    const runId = phase.runId;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(
          `/api/github/auth/poll?runId=${encodeURIComponent(runId)}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (data.state === "success") {
          setPhase({ kind: "success", login: data.login || "" });
          onSuccess(data.login || "");
          return;
        }
        if (data.state === "failed") {
          setPhase({ kind: "failed", error: data.error });
          return;
        }
      } catch {
        // Network blip - keep polling
      }
    };

    const interval = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase, onSuccess]);

  const copyCode = async () => {
    if (phase.kind !== "waiting") return;
    try {
      await navigator.clipboard.writeText(phase.deviceCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-bg-elevated p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3">
          <Github className="h-6 w-6 text-fg" />
          <h2 className="display text-[20px] tracking-display-tight text-fg">
            Sign in to GitHub
          </h2>
        </header>

        {phase.kind === "starting" && (
          <p className="mt-5 flex items-center gap-2 text-[14px] text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Starting sign-in…
          </p>
        )}

        {phase.kind === "waiting" && (
          <>
            <ol className="mt-5 space-y-4 text-[14px] text-fg">
              <li>
                <div className="flex items-baseline gap-2">
                  <span className="text-fg-dim">1.</span>
                  <span>Copy this one-time code:</span>
                </div>
                <button
                  type="button"
                  onClick={copyCode}
                  className="mt-2 flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-bg px-4 py-3 transition-colors hover:border-accent"
                >
                  <span className="mono text-[20px] tracking-widest text-fg">
                    {phase.deviceCode}
                  </span>
                  <span className="flex items-center gap-1 text-[12px] text-fg-muted">
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        copy
                      </>
                    )}
                  </span>
                </button>
              </li>

              <li>
                <div className="flex items-baseline gap-2">
                  <span className="text-fg-dim">2.</span>
                  <span>Open GitHub and paste the code:</span>
                </div>
                <a
                  href={phase.verificationUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-accent-push/45 bg-accent-push/15 px-4 py-3 text-[14px] font-medium text-accent-push transition-colors hover:bg-accent-push/25"
                >
                  Open GitHub in browser
                  <ExternalLink className="h-4 w-4" />
                </a>
              </li>

              <li>
                <div className="flex items-baseline gap-2">
                  <span className="text-fg-dim">3.</span>
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-fg-muted" />
                    <span className="text-fg-muted">
                      Waiting for you to authorize…
                    </span>
                  </span>
                </div>
              </li>
            </ol>

            <button
              type="button"
              onClick={onClose}
              className="mt-6 w-full rounded-lg border border-border bg-bg px-4 py-2 text-[13px] text-fg-muted transition-colors hover:text-fg"
            >
              Cancel
            </button>
          </>
        )}

        {phase.kind === "success" && (
          <div className="mt-5">
            <p className="flex items-center gap-2 text-[14px] text-accent">
              <Check className="h-4 w-4" />
              Signed in{phase.login ? ` as ${phase.login}` : ""}.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-full border border-accent-push/45 bg-accent-push/15 px-4 py-2 text-[14px] font-medium text-accent-push transition-colors hover:bg-accent-push/25"
            >
              Done
            </button>
          </div>
        )}

        {phase.kind === "failed" && (
          <div className="mt-5">
            <p className="text-[14px] text-accent-attention">
              Sign-in failed.
            </p>
            <pre className="mono mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-bg p-3 text-[11px] text-fg-muted">
              {phase.error}
            </pre>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  startedRef.current = false;
                  setPhase({ kind: "starting" });
                }}
                className="flex-1 rounded-full border border-accent-push/45 bg-accent-push/15 px-4 py-2 text-[14px] font-medium text-accent-push transition-colors hover:bg-accent-push/25"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-border bg-bg px-4 py-2 text-[14px] text-fg-muted transition-colors hover:text-fg"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
