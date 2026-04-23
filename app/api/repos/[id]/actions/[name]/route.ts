import { NextResponse } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import { validateCsrf } from "@/lib/security/csrf";
import { getRepoById, getSnapshot } from "@/lib/db/repos";
import { isValidAction, startAction } from "@/lib/git/actions";
import { getScheduler } from "@/lib/scan/scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; name: string }> },
) {
  await bootstrap();

  const csrf = req.headers.get("x-csrf-token");
  if (!validateCsrf(csrf)) {
    return NextResponse.json({ error: "invalid csrf" }, { status: 403 });
  }

  const { id, name } = await ctx.params;
  const repoId = Number(id);
  if (!Number.isInteger(repoId) || repoId <= 0) {
    return NextResponse.json({ error: "invalid repo id" }, { status: 400 });
  }
  if (!isValidAction(name)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  const repo = getRepoById(repoId);
  if (!repo || repo.deletedAt !== null) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }

  const snap = getSnapshot(repoId);
  let run;
  try {
    run = startAction({
      repoId,
      repoPath: repo.repoPath,
      action: name,
      branch: snap?.branch ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }

  // Schedule a post-action refresh so the UI updates when the run completes
  run.emitter.once("done", () => {
    getScheduler()?.collectOne(repoId).catch(() => {});
  });

  return NextResponse.json({ runId: run.id });
}
