"use client";

import { useState } from "react";
import { Check, KeyRound, Loader2, ShieldCheck, X } from "lucide-react";

interface Props {
  csrfToken: string;
  onClose: () => void;
  onSuccess: () => void;
  // Called when the error state needs the user to refresh GitHub scopes.
  // The parent should close this modal and open the gh sign-in flow.
  onReconnectGitHub: () => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "success"; keyPath: string; alreadyRegistered: boolean }
  | { kind: "error"; message: string; needsReconnect: boolean };

export function SigningSetupModal({ csrfToken, onClose, onSuccess, onReconnectGitHub }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const run = async () => {
    setPhase({ kind: "working" });
    try {
      const res = await fetch("/api/signing/setup", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        keyPath?: string;
        alreadyRegistered?: boolean;
        needsReconnect?: boolean;
      };
      if (!res.ok || !data.ok) {
        setPhase({
          kind: "error",
          message: data.error ?? "Setup failed",
          needsReconnect: Boolean(data.needsReconnect),
        });
        return;
      }
      setPhase({
        kind: "success",
        keyPath: data.keyPath ?? "",
        alreadyRegistered: data.alreadyRegistered ?? false,
      });
      onSuccess();
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error).message, needsReconnect: false });
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
          <ShieldCheck className="h-6 w-6 text-fg" />
          <h2 className="display text-[20px] tracking-display-tight text-fg">
            Set up commit signing
          </h2>
        </header>

        {phase.kind === "idle" && (
          <>
            <div className="mt-5 space-y-3 text-[14px] text-fg-muted">
              <p>
                gitdash will create or reuse an SSH key on this machine and
                register it on GitHub. After that, all commits made from
                gitdash will carry a verified signature.
              </p>
              <ul className="space-y-1.5 pl-1">
                <li className="flex items-start gap-2">
                  <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-fg-dim" />
                  <span>Looks for an existing key in <span className="mono text-[12px]">~/.ssh/</span> before generating a new one</span>
                </li>
                <li className="flex items-start gap-2">
                  <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-fg-dim" />
                  <span>Uploads the public key to GitHub — private key never leaves your machine</span>
                </li>
                <li className="flex items-start gap-2">
                  <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-fg-dim" />
                  <span>Sets <span className="mono text-[12px]">gpg.format=ssh</span> in your global git config</span>
                </li>
              </ul>
            </div>
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={run}
                className="flex-1 rounded-full border border-accent-push/45 bg-accent-push/15 px-4 py-2 text-[13px] font-medium text-accent-push transition-colors hover:bg-accent-push/25"
              >
                Set up signing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-full border border-border px-4 py-2 text-[13px] text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {phase.kind === "working" && (
          <p className="mt-5 flex items-center gap-2 text-[14px] text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Setting up commit signing…
          </p>
        )}

        {phase.kind === "success" && (
          <div className="mt-5">
            <p className="flex items-center gap-2 text-[14px] text-accent-clean">
              <Check className="h-4 w-4" />
              Done. Your commits are now signed and verified by GitHub.
            </p>
            {phase.alreadyRegistered && (
              <p className="mt-2 text-[12px] text-fg-muted">
                The key was already registered on GitHub — git config updated to point to it.
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-full border border-accent-clean/45 bg-accent-clean/15 px-4 py-2 text-[13px] font-medium text-accent-clean transition-colors hover:bg-accent-clean/25"
            >
              Close
            </button>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="mt-5">
            <p className="text-[14px] text-accent-attention">Setup failed.</p>
            <pre className="mono mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-bg p-3 text-[11px] text-fg-muted">
              {phase.message}
            </pre>
            {phase.needsReconnect ? (
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={onReconnectGitHub}
                  className="w-full rounded-full border border-accent-push/45 bg-accent-push/15 px-4 py-2 text-[13px] font-medium text-accent-push transition-colors hover:bg-accent-push/25"
                >
                  Reconnect GitHub
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-full border border-border px-4 py-2 text-[13px] text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPhase({ kind: "idle" })}
                  className="flex-1 rounded-full border border-accent-push/45 bg-accent-push/15 px-4 py-2 text-[13px] font-medium text-accent-push transition-colors hover:bg-accent-push/25"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-full border border-border px-4 py-2 text-[13px] text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        )}

        {phase.kind !== "idle" && phase.kind !== "working" && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-full text-fg-dim transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
