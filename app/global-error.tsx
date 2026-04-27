"use client";

import { useEffect, useState } from "react";
import { clearReloadBudget, hardReload, isChunkLoadError, tryConsumeReloadBudget } from "@/lib/autoheal";

// Root-level error boundary. Catches anything that escapes layout.tsx — e.g.
// a render error in the dashboard tree or a chunk failure during initial
// hydration. Without this file, Next.js shows the bare "Application error"
// page, which is exactly what we're trying to eliminate.
//
// Behavior:
//   - ChunkLoadError → hard-reload immediately (within budget). The new HTML
//     will reference fresh hashes.
//   - Anything else → friendly UI + Reload button + auto-reload after 5s.
//   - Loop guard: third reload in 30s shows the friendly UI instead, so a
//     truly broken build can't spin the browser forever.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunk = isChunkLoadError(error);
  const [secondsLeft, setSecondsLeft] = useState(chunk ? 0 : 5);

  useEffect(() => {
    if (typeof window !== "undefined" && typeof console !== "undefined") {
      console.error("[gitdash] global error boundary tripped:", error);
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          background: "#0b0d0c",
          color: "#e8efe9",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: 28, fontWeight: 500, margin: "0 0 12px" }}>
            {chunk ? "Reloading…" : "Something glitched."}
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: "#9aa6a0", margin: "0 0 24px" }}>
            {chunk
              ? "gitdash was just updated — refreshing to pick up the new version."
              : secondsLeft > 0
                ? `Auto-reloading in ${secondsLeft}s. If it keeps happening, try again from the dashboard.`
                : "Auto-reload paused after a few attempts. Click Reload to try once more."}
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => {
                clearReloadBudget();
                hardReload();
              }}
              style={{
                background: "#3aa688",
                color: "#0b0d0c",
                border: 0,
                borderRadius: 999,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload now
            </button>
            <button
              type="button"
              onClick={() => {
                if (chunk) {
                  // For chunk errors, reset() just re-runs the same broken
                  // bundle. Force a fresh fetch instead.
                  clearReloadBudget();
                  hardReload();
                } else {
                  reset();
                }
              }}
              style={{
                background: "transparent",
                color: "#9aa6a0",
                border: "1px solid #2a3431",
                borderRadius: 999,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
