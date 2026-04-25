"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const BUNDLED_COMMIT = process.env.NEXT_PUBLIC_GITDASH_COMMIT ?? "";

export function UpdateBanner() {
  const [serverCommit, setServerCommit] = useState<string | null>(null);

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

  // No BUNDLED_COMMIT means we can't compare — render nothing
  if (!BUNDLED_COMMIT) return null;

  // Still loading or commits match — no banner needed
  if (!serverCommit || serverCommit === BUNDLED_COMMIT) return null;

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
      <span>A new version of gitdash is available.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className={cn(
          "rounded-md bg-accent-positive px-3 py-1 text-sm font-medium",
          "text-bg hover:opacity-90",
        )}
      >
        Reload
      </button>
    </div>
  );
}
