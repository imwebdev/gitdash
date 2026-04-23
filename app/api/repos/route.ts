import { NextResponse } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import { getStore } from "@/lib/state/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  await bootstrap();
  const url = new URL(req.url);
  const includeSystem = url.searchParams.get("showSystem") === "1";
  const repos = getStore().snapshot(includeSystem);
  return NextResponse.json({ repos });
}
