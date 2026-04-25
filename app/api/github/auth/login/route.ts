import { NextResponse, type NextRequest } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import { validateCsrf } from "@/lib/security/csrf";
import { startGhAuthLogin, isGhAuthenticated } from "@/lib/gh/auth";

export async function POST(req: NextRequest) {
  await bootstrap();

  if (!validateCsrf(req.headers.get("x-csrf-token"))) {
    return NextResponse.json({ error: "csrf" }, { status: 403 });
  }

  const existing = await isGhAuthenticated();
  if (existing) {
    return NextResponse.json({ alreadyAuthenticated: true, login: existing });
  }

  try {
    const result = await startGhAuthLogin();
    return NextResponse.json(result);
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    return NextResponse.json(
      {
        error: "could not start GitHub sign-in",
        detail: message.slice(0, 500),
      },
      { status: 502 },
    );
  }
}
