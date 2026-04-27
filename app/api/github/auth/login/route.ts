import { NextResponse, type NextRequest } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import { validateCsrf } from "@/lib/security/csrf";
import {
  startGhAuthLogin,
  startGhAuthRefresh,
  isGhAuthenticated,
  getGhAuthScopes,
} from "@/lib/gh/auth";

// Scopes gitdash needs to do its job: `repo` for push/clone of private
// repos, `workflow` so pushing branches with workflow files isn't blocked,
// `write:ssh_signing_key` so gitdash can register SSH signing keys on GitHub.
// `gh auth login` requests these by default; users who installed gh through
// other tools may have a token with fewer scopes. The health banner detects
// that case and surfaces "Connect GitHub" — which lands here and runs
// `gh auth refresh -s <missing>` to add the scopes without re-doing login.
const REQUIRED_SCOPES = ["repo", "workflow", "write:ssh_signing_key"];

export async function POST(req: NextRequest) {
  await bootstrap();

  if (!validateCsrf(req.headers.get("x-csrf-token"))) {
    return NextResponse.json({ error: "csrf" }, { status: 403 });
  }

  const existing = await isGhAuthenticated();

  if (!existing) {
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

  // Authenticated — check scopes. If the token is missing any required
  // scope, drive `gh auth refresh -s <missing>` through the same device
  // flow so GitHub prompts the user to grant the additional scopes.
  const scopes = await getGhAuthScopes();
  const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));

  if (missing.length === 0) {
    return NextResponse.json({ alreadyAuthenticated: true, login: existing });
  }

  try {
    const result = await startGhAuthRefresh(missing);
    return NextResponse.json({ ...result, refreshing: true, missingScopes: missing });
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    return NextResponse.json(
      {
        error: "could not start GitHub scope upgrade",
        detail: message.slice(0, 500),
      },
      { status: 502 },
    );
  }
}
