import { NextResponse } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import { validateCsrf } from "@/lib/security/csrf";
import { getRepoById, getSnapshot } from "@/lib/db/repos";
import {
  isValidAction,
  isValidPublishName,
  startAction,
  type PublishOptions,
  type WipRestoreOptions,
} from "@/lib/git/actions";
import { isSafeRef } from "@/lib/git/exec";
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

  let commitMessage: string | undefined;
  let publish: PublishOptions | undefined;
  let wipRestore: WipRestoreOptions | undefined;
  if (name === "commit-push" || name === "commit") {
    try {
      const body = (await req.json()) as { commitMessage?: unknown };
      if (typeof body.commitMessage === "string") {
        commitMessage = body.commitMessage;
      }
    } catch {
      // empty body is fine; sanitizer will use default
    }
  } else if (name === "publish-to-github") {
    let body: { name?: unknown; visibility?: unknown; description?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "publish requires a JSON body" }, { status: 400 });
    }
    if (typeof body.name !== "string" || !isValidPublishName(body.name)) {
      return NextResponse.json(
        { error: "invalid repository name (use letters, numbers, dots, dashes, underscores; 1-100 chars)" },
        { status: 400 },
      );
    }
    const visibility = body.visibility === "public" ? "public" : "private";
    const description = typeof body.description === "string" ? body.description : undefined;
    publish = { name: body.name, visibility, description };
  } else if (name === "wip-restore") {
    let body: { wipBranch?: unknown; deleteAfter?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "wip-restore requires a JSON body" }, { status: 400 });
    }
    if (typeof body.wipBranch !== "string" || !isSafeRef(body.wipBranch)) {
      return NextResponse.json({ error: "invalid wipBranch" }, { status: 400 });
    }
    wipRestore = {
      wipBranch: body.wipBranch,
      deleteAfter: body.deleteAfter === true,
    };
  }

  const snap = getSnapshot(repoId);
  let run;
  try {
    run = startAction({
      repoId,
      repoPath: repo.repoPath,
      action: name,
      branch: snap?.branch ?? null,
      commitMessage,
      publish,
      wipRestore,
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
