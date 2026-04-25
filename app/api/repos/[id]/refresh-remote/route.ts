import { NextResponse } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import { validateCsrf } from "@/lib/security/csrf";
import { getRepoById } from "@/lib/db/repos";
import { getScheduler, rateLimitCheck, recordRefreshTimestamp } from "@/lib/scan/scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/repos/[id]/refresh-remote
 *
 * Force-refreshes the remote state for a single repo by:
 *   1. Invalidating the gh_etag_cache entries for the repo's slug.
 *   2. Calling compareWithRemote (fresh GH API call).
 *   3. Writing the result to the snapshot and emitting a store update.
 *
 * Rate-limited to one call per repo per 5 s (in-memory). Returns 429 with
 * { retryAfterMs } when the limit is hit. CSRF required.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await bootstrap();

  const csrf = req.headers.get("x-csrf-token");
  if (!validateCsrf(csrf)) {
    return NextResponse.json({ error: "invalid csrf" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const repoId = Number(id);
  if (!Number.isInteger(repoId) || repoId <= 0) {
    return NextResponse.json({ error: "invalid repo id" }, { status: 400 });
  }

  const repo = getRepoById(repoId);
  if (!repo || repo.deletedAt !== null) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }

  const limit = rateLimitCheck(repoId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate-limited", retryAfterMs: limit.retryAfterMs },
      { status: 429 },
    );
  }

  const scheduler = getScheduler();
  if (!scheduler) {
    return NextResponse.json({ error: "scheduler not running" }, { status: 503 });
  }

  // Record timestamp before the call so back-to-back clicks are rejected even
  // if the gh API is slow.
  recordRefreshTimestamp(repoId);

  const result = await scheduler.refreshRemoteOne(repoId);
  return NextResponse.json(result);
}
