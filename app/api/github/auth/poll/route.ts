import { NextResponse, type NextRequest } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import { getAuthState, isGhAuthenticated } from "@/lib/gh/auth";

export async function GET(req: NextRequest) {
  await bootstrap();

  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  const state = getAuthState(runId);
  if (!state) {
    return NextResponse.json({ error: "unknown runId" }, { status: 404 });
  }

  if (state.state === "success") {
    // Try to enrich with the actual login if gh auth completed.
    const login = state.login || (await isGhAuthenticated()) || "";
    return NextResponse.json({ state: "success", login });
  }

  return NextResponse.json(state);
}
