import { NextResponse } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import { getStore } from "@/lib/state/store";
import { getUnacknowledgedAlertCounts } from "@/lib/db/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  await bootstrap();
  const url = new URL(req.url);
  const includeSystem = url.searchParams.get("showSystem") === "1";
  const repos = getStore().snapshot(includeSystem);
  const alertCounts = getUnacknowledgedAlertCounts(repos.map((r) => r.id));
  const reposWithAlerts = repos.map((r) => ({
    ...r,
    pullAlertCount: alertCounts.get(r.id) ?? 0,
  }));
  return NextResponse.json({ repos: reposWithAlerts });
}
