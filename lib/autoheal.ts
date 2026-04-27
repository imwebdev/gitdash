// Client-only helpers for auto-healing transient client-side failures.
//
// Two failure modes drive most "Application error: a client-side exception"
// pages:
//   1. Stale chunks — after a rebuild the running next-server (or a long-lived
//      tab) tries to load /_next/static/chunks/<old-hash>.js which 404s and
//      throws ChunkLoadError. The fix is a hard reload; the new HTML points at
//      the new hashes.
//   2. Genuine bugs — anything else. We can't recover, but we can replace the
//      bare Next.js fallback with a friendly UI + Reload + delayed auto-reload.
//
// The reload-loop guard caps total auto-reloads at 3 inside a 30s window so a
// truly broken build can't spin the browser forever — the third hit shows the
// friendly UI instead.
//
// All functions here are SSR-safe (guarded by typeof window).
"use client";
























const RELOAD_BUDGET_KEY = "gitdash:autoheal:reloads";
const RELOAD_WINDOW_MS = 30_000;
const RELOAD_BUDGET = 3;

const CHUNK_PATTERN =
  /chunkloaderror|loading chunk|loading css chunk|failed to fetch dynamically imported module|error loading dynamically imported module/i;

interface ReloadBudget {
  count: number;
  firstAt: number;
}

function readBudget(): ReloadBudget {
  if (typeof window === "undefined") return { count: 0, firstAt: 0 };
  try {
    const raw = window.sessionStorage.getItem(RELOAD_BUDGET_KEY);
    if (!raw) return { count: 0, firstAt: 0 };
    const parsed = JSON.parse(raw) as ReloadBudget;
    if (Date.now() - parsed.firstAt > RELOAD_WINDOW_MS) {
      return { count: 0, firstAt: 0 };
    }
    return parsed;
  } catch {
    return { count: 0, firstAt: 0 };
  }
}

function writeBudget(b: ReloadBudget): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(RELOAD_BUDGET_KEY, JSON.stringify(b));
  } catch {
    // sessionStorage may be unavailable (private mode, etc.) — without it the
    // loop guard degrades to "always allowed", which is acceptable.
  }
}

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    err instanceof Error
      ? `${err.name} ${err.message}`
      : typeof err === "string"
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();
  return CHUNK_PATTERN.test(msg);
}

/**
 * Returns true if the caller is allowed to auto-reload right now. Increments
 * the budget. Returns false once the cap is hit so the UI can fall back to
 * "show the friendly error and let the human decide".
 */
export function tryConsumeReloadBudget(): boolean {
  if (typeof window === "undefined") return false;
  const budget = readBudget();
  const now = Date.now();
  if (budget.count === 0 || now - budget.firstAt > RELOAD_WINDOW_MS) {
    writeBudget({ count: 1, firstAt: now });
    return true;
  }
  if (budget.count >= RELOAD_BUDGET) return false;
  writeBudget({ count: budget.count + 1, firstAt: budget.firstAt });
  return true;
}

/**
 * Hard-reload with a cache-bust query so intermediaries (proxies, service
 * workers, the browser disk cache) can't keep handing back the stale HTML.
 * Strips any prior _gitdash_heal param to avoid stacking.
 */
export function hardReload(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("_gitdash_heal");
    url.searchParams.set("_gitdash_heal", String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}
