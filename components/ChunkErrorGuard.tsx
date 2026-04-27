"use client";

import { useEffect } from "react";
import { hardReload, isChunkLoadError, tryConsumeReloadBudget } from "@/lib/autoheal";

// Catches async chunk-load failures that bypass React error boundaries.
// React boundaries only see render-time errors; if a lazy import() promise or
// dynamic chunk fetch rejects outside the render cycle the error reaches
// `window.onerror` / `window.onunhandledrejection` instead. Without this guard
// those failures still produce the bare "Application error" page after Next's
// internal recovery gives up.
//
// Mount once at the layout root.
export function ChunkErrorGuard() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleError = (event: ErrorEvent) => {
      if (!isChunkLoadError(event.error ?? event.message)) return;
      if (!tryConsumeReloadBudget()) return;
      hardReload();
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (!isChunkLoadError(event.reason)) return;
      if (!tryConsumeReloadBudget()) return;
      hardReload();
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
