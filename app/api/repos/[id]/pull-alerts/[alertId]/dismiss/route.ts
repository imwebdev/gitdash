import { NextResponse } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import { validateCsrf } from "@/lib/security/csrf";
import { getRepoById } from "@/lib/db/repos";
import { dismissAlert } from "@/lib/db/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; alertId: string }> },
) {
  await bootstrap();

  const csrf = req.headers.get("x-csrf-token");
  if (!validateCsrf(csrf)) {
    return NextResponse.json({ error: "invalid csrf" }, { status: 403 });
  }

  const { id, alertId } = await ctx.params;
  const repoId = Number(id);
  const alertIdNum = Number(alertId);
  if (!Number.isInteger(repoId) || repoId <= 0) {
    return NextResponse.json({ error: "invalid repo id" }, { status: 400 });
  }
  if (!Number.isInteger(alertIdNum) || alertIdNum <= 0) {
    return NextResponse.json({ error: "invalid alert id" }, { status: 400 });
  }

  const repo = getRepoById(repoId);
  if (!repo || repo.deletedAt !== null) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }

  const ok = dismissAlert(alertIdNum, Date.now());
  if (!ok) {
    return NextResponse.json({ error: "alert not found or already dismissed" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
