import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { validateCsrf } from "@/lib/security/csrf";
import { displayLabel } from "@/lib/security/label";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? ".", ".config");
  return path.join(xdg, "gitdash", "config.json");
}

async function readConfig(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(configPath(), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeConfig(data: Record<string, unknown>): Promise<void> {
  const p = configPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function GET(): Promise<NextResponse> {
  const config = await readConfig();
  const stored = typeof config.machineLabel === "string" ? config.machineLabel : null;
  const host = hostname();
  const isDefault = !stored || stored.trim().length === 0;
  const label = displayLabel(stored, host);
  return NextResponse.json({ label, isDefault, hostname: host });
}

export async function PUT(req: Request): Promise<NextResponse> {
  const csrf = req.headers.get("x-csrf-token");
  if (!validateCsrf(csrf)) {
    return NextResponse.json({ error: "invalid csrf" }, { status: 403 });
  }

  let body: { label?: unknown };
  try {
    body = (await req.json()) as { label?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const raw = typeof body.label === "string" ? body.label.trim() : "";
  const config = await readConfig();

  if (raw.length === 0) {
    // Unset — remove the key so hostname fallback takes over
    delete config.machineLabel;
  } else {
    config.machineLabel = raw;
  }

  await writeConfig(config);

  const host = hostname();
  const isDefault = raw.length === 0;
  const label = displayLabel(raw || null, host);
  return NextResponse.json({ label, isDefault, hostname: host });
}
