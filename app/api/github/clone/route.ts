import { NextResponse, type NextRequest } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import { validateCsrf } from "@/lib/security/csrf";
import { cloneGithubRepo, CloneError, resolveCloneDir } from "@/lib/gh/clone";
import { getScheduler } from "@/lib/scan/scheduler";
import { readFile } from "node:fs/promises";
import path from "node:path";

interface CloneRequestBody {
  owner?: unknown;
  name?: unknown;
}

interface CloneConfig {
  cloneDir?: string;
}

async function readCloneConfig(): Promise<CloneConfig> {
  const xdg =
    process.env.XDG_CONFIG_HOME ??
    path.join(process.env.HOME ?? ".", ".config");
  const configPath = path.join(xdg, "gitdash", "config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw) as CloneConfig;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  if (!validateCsrf(req.headers.get("x-csrf-token"))) {
    return NextResponse.json({ error: "invalid csrf" }, { status: 403 });
  }

  await bootstrap();

  let body: CloneRequestBody;
  try {
    body = (await req.json()) as CloneRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const owner = typeof body.owner === "string" ? body.owner : "";
  const name = typeof body.name === "string" ? body.name : "";
  if (!owner || !name) {
    return NextResponse.json(
      { error: "owner and name are required strings" },
      { status: 400 },
    );
  }

  const config = await readCloneConfig();
  const cloneDir = resolveCloneDir(config.cloneDir);

  try {
    const result = await cloneGithubRepo({ owner, name, cloneDir });

    // Ask the scheduler to discover the new repo + take a fresh snapshot.
    // Best-effort — if the scheduler isn't ready yet, the next periodic
    // discovery cycle will pick up the freshly-cloned repo on its own.
    try {
      const scheduler = getScheduler();
      if (scheduler) {
        await scheduler.runDiscovery();
      }
    } catch {
      // ignore — scheduler nudge is non-critical
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CloneError) {
      return NextResponse.json(
        {
          error: err.message,
          destination: err.destination,
          output: err.output,
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message ?? String(err) },
      { status: 500 },
    );
  }
}
