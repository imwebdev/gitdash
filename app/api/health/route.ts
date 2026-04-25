import { NextResponse } from "next/server";
import { checkHealth } from "@/lib/health/check";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const result = await checkHealth();
  return NextResponse.json(result);
}
