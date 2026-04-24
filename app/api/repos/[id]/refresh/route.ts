import { NextResponse } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import { validateCsrf } from "@/lib/security/csrf";
import { getRepoById } from "@/lib/db/repos";
import { getScheduler } from "@/lib/scan/scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lightweight "re-check this repo against GitHub" endpoint.
 *
 * Triggers the scheduler's collectOne() which uses gh api (the same
 * code path the background classifier uses). Does NOT run `git fetch`
 * — that requires SSH/HTTPS auth on the local remote, fails with
 * "Permission denied (publickey)" for repos using SSH URLs without
 * an SSH key configured on the host.
 *
 * Backs the per-row 🔄 Refresh icon button (no modal, no streaming).
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

  const scheduler = getScheduler();
  if (!scheduler) {
    return NextResponse.json({ error: "scheduler not running" }, { status: 503 });
  }

  try {
    await scheduler.collectOne(repoId);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
