"use client";

import { useEffect, useState } from "react";
import { clearReloadBudget, hardReload, isChunkLoadError, tryConsumeReloadBudget } from "@/lib/autoheal";

// Page-level error boundary. Catches errors thrown inside the dashboard tree
// (anything below RootLayout). Same auto-heal contract as global-error.tsx
// but renders inside the existing layout chrome, and exposes reset() so a
// soft retry is possible without a full page reload.
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunk = isChunkLoadError(error);
  const [secondsLeft, setSecondsLeft] = useState(chunk ? 0 : 5);

  useEffect(() => {
    if (typeof console !== "undefined") {
      console.error("[gitdash] page error boundary tripped:", error);
    }

    if (chunk) {
      if (tryConsumeReloadBudget()) {
        hardReload();
        return;
      }
      return;
    }

    if (!tryConsumeReloadBudget()) return;
    const tick = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(tick);
          hardReload();
          return 0;
        }
        return s - 1;
      });
    }, 1_000);
    return () => clearInterval(tick);
  }, [chunk, error]);

  return (
    <main className="grain relative mx-auto flex min-h-[60vh] max-w-[640px] flex-col items-center justify-center gap-5 px-4 py-16 text-center sm:py-24">
      <h1 className="display text-[28px] tracking-display-tight text-fg sm:text-[32px]">
        {chunk ? "Reloading…" : "Something glitched."}
      </h1>
      <p className="max-w-md text-[14px] leading-relaxed text-fg-muted sm:text-[15px]">
        {chunk
          ? "gitdash was just updated — refreshing to pick up the new version."
          : secondsLeft > 0
            ? `Auto-reloading in ${secondsLeft}s. If it keeps happening, try again from the dashboard.`
            : "Auto-reload paused after a few attempts. Click Reload to try once more."}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => {
            clearReloadBudget();
            hardReload();
          }}
          className="rounded-full bg-accent-clean px-5 py-2 text-[13px] font-semibold text-bg transition-colors hover:opacity-90"
        >
          Reload now
        </button>
        <button
          type="button"
          onClick={() => {
            if (chunk) {
              clearReloadBudget();
              hardReload();
            } else {
              reset();
            }
          }}
          className="rounded-full border border-border px-5 py-2 text-[13px] font-medium text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
