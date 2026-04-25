"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertOctagon, AlertTriangle, RefreshCw, X } from "lucide-react";
import { GhSignInModal } from "./GhSignInModal";
import { cn } from "@/lib/utils";

interface HealthWarning {
  severity: "error" | "warning";
  code:
    | "gh-not-installed"
    | "gh-not-authenticated"
    | "gh-missing-repo-scope"
    | "git-not-installed";
  message: string;
  action: "open-sign-in" | null;
  installHints?: string[];
}

interface HealthResult {
  warnings: HealthWarning[];
}

const POLL_INTERVAL_MS = 30_000;
const DISMISS_KEY = "gitdash:health-dismissed";

interface Props {
  csrfToken: string;
}

export function HealthBanner({ csrfToken }: Props) {
  const [warnings, setWarnings] = useState<HealthWarning[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = sessionStorage.getItem(DISMISS_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  const [signInOpen, setSignInOpen] = useState(false);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as HealthResult;
        setWarnings(data.warnings);
      }
    } catch {
      // Network blip — keep last state, banner UI shows stale until next tick.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHealth();
    const id = setInterval(fetchHealth, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchHealth]);

  const persistDismiss = (next: Set<string>) => {
    setDismissed(next);
    try {
      sessionStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // sessionStorage unavailable — banner just won't remember dismissal
      // for this tab. Dismissal still works visually for the session.
    }
  };

  const dismiss = (code: string) => {
    const next = new Set(dismissed);
    next.add(code);
    persistDismiss(next);
  };

  const visible = warnings.filter((w) => !dismissed.has(w.code));
  if (visible.length === 0) return null;

  return (
    <>
      <section
        aria-label="GitHub connection status"
        className="mb-6 flex flex-col gap-3 rounded-xl border border-border-subtle bg-bg-elevated/80 p-4 shadow-sm sm:p-5"
      >
        {visible.map((w) => (
          <WarningRow
            key={w.code}
            warning={w}
            onAction={() => setSignInOpen(true)}
            onDismiss={() => dismiss(w.code)}
          />
        ))}
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => void fetchHealth()}
            disabled={loading}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:border-fg-muted hover:text-fg",
              loading && "opacity-60",
            )}
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            Re-check
          </button>
        </div>
      </section>

      {signInOpen && (
        <GhSignInModal
          csrfToken={csrfToken}
          onClose={() => setSignInOpen(false)}
          onSuccess={() => {
            setSignInOpen(false);
            // Force a re-check immediately so the banner updates without
            // waiting for the 30s poll.
            void fetchHealth();
          }}
        />
      )}
    </>
  );
}

function WarningRow({
  warning,
  onAction,
  onDismiss,
}: {
  warning: HealthWarning;
  onAction: () => void;
  onDismiss: () => void;
}) {
  const Icon = warning.severity === "error" ? AlertOctagon : AlertTriangle;
  const iconColor =
    warning.severity === "error"
      ? "text-accent-attention"
      : "text-accent-dirty";

  return (
    <div className="flex items-start gap-3">
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", iconColor)} />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-relaxed text-fg">{warning.message}</p>

        {warning.action === "open-sign-in" && (
          <button
            type="button"
            onClick={onAction}
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-accent-push/45 bg-accent-push/15 px-4 py-1.5 text-[12.5px] font-medium text-accent-push transition-colors hover:bg-accent-push/25"
          >
            Connect GitHub
          </button>
        )}

        {warning.installHints && warning.installHints.length > 0 && (
          <ul className="mt-3 space-y-1 text-[12px] text-fg-muted">
            {warning.installHints.map((hint) => (
              <li key={hint} className="mono">
                {hint}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-fg-dim transition-colors hover:bg-bg-hover hover:text-fg"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
