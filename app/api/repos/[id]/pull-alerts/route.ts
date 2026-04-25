import { NextResponse } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import { getRepoById } from "@/lib/db/repos";
import { getUnacknowledgedAlerts } from "@/lib/db/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await bootstrap();

  const { id } = await ctx.params;
  const repoId = Number(id);
  if (!Number.isInteger(repoId) || repoId <= 0) {
    return NextResponse.json({ error: "invalid repo id" }, { status: 400 });
  }

  const repo = getRepoById(repoId);
  if (!repo || repo.deletedAt !== null) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }

  const alerts = getUnacknowledgedAlerts(repoId);
  return NextResponse.json({ alerts });
}
