import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VERSION = process.env.NEXT_PUBLIC_GITDASH_VERSION ?? "";
const COMMIT = process.env.NEXT_PUBLIC_GITDASH_COMMIT ?? "";
const BUILT_AT = process.env.NEXT_PUBLIC_GITDASH_BUILT_AT ?? "";

export async function GET() {
  return NextResponse.json(
    { version: VERSION, commit: COMMIT, builtAt: BUILT_AT },
    {
      headers: {
        "Cache-Control": "no-store, must-revalidate",
        Pragma: "no-cache",
      },
    },
  );
}
