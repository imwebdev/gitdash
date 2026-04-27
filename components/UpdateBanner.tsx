"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { hardReload, tryConsumeReloadBudget } from "@/lib/autoheal";

const BUNDLED_COMMIT = process.env.NEXT_PUBLIC_GITDASH_COMMIT ?? "";
const AUTO_RELOAD_AFTER_MS = 5_000;

export function UpdateBanner() {
  const [serverCommit, setServerCommit] = useState<string | null>(null);
  const [autoReloadAt, setAutoReloadAt] = useState<number | null>(null);

  useEffect(() => {
    // Don't poll if we have nothing to compare against (e.g. tarball install)
    if (!BUNDLED_COMMIT) return;

    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { commit?: string };
        if (!cancelled && data.commit) setServerCommit(data.commit);
      } catch {
        // ignore network blips
      }
    }

    check();
    const interval = setInterval(check, 30_000);

    function onFocus() {
      check();
    }

    function onVisibilityChange() {
      if (!document.hidden) check();
    }

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const mismatch = !!(BUNDLED_COMMIT && serverCommit && serverCommit !== BUNDLED_COMMIT);

  useEffect(() => {
    if (!mismatch) {
      setAutoReloadAt(null);
      return;
    }
    // Auto-reload onto the new build so a stale tab can't keep loading dead
    // chunk hashes. The reload-budget guard prevents loops if the mismatch
    // somehow persists across reloads.
    if (!tryConsumeReloadBudget()) return;
    const fireAt = Date.now() + AUTO_RELOAD_AFTER_MS;
    setAutoReloadAt(fireAt);
    const t = setTimeout(() => hardReload(), AUTO_RELOAD_AFTER_MS);
    return () => clearTimeout(t);
  }, [mismatch]);

  if (!mismatch) return null;

  const secondsLeft = autoReloadAt
    ? Math.max(0, Math.ceil((autoReloadAt - Date.now()) / 1_000))
    : null;

  return (
    <div
      className={cn(
        "fixed top-2 left-1/2 z-50 -translate-x-1/2",
        "rounded-md border border-accent-positive bg-bg-elevated px-4 py-2",
        "shadow-lg",
        "flex items-center gap-3 text-sm text-fg",
      )}
      role="status"
    >
      <span>
        New gitdash version detected
        {secondsLeft !== null ? ` — reloading in ${secondsLeft}s.` : "."}
      </span>
      <button
        type="button"
        onClick={() => hardReload()}
        className={cn(
          "rounded-full border border-accent-clean/45 bg-accent-clean/15 px-3 py-1 text-sm font-medium",
          "text-accent-clean hover:bg-accent-clean/25",
        )}
      >
        Reload now
      </button>
    </div>
  );
}
