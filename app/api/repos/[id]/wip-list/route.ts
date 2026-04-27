import { NextResponse } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import { getRepoById } from "@/lib/db/repos";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hostname } from "node:os";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeLabel } from "@/lib/security/label";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

export interface WipEntry {
  branch: string;
  source: string | null;
  machineLabel: string;
  timestamp: string | null;
  isOwn: boolean;
}

async function getLocalMachineLabel(): Promise<string> {
  try {
    const xdg = process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? ".", ".config");
    const configPath = path.join(xdg, "gitdash", "config.json");
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.machineLabel === "string" && parsed.machineLabel.trim().length > 0) {
      return sanitizeLabel(parsed.machineLabel.trim());
    }
  } catch {
    // fall through
  }
  return sanitizeLabel(hostname()) || "gitdash";
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
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

  const url = new URL(req.url);
  const includeMine = url.searchParams.get("mine") === "true";

  // Get the local machine label to identify own WIP branch
  const localLabel = await getLocalMachineLabel();
  const ownWipBranch = `wip/${localLabel}`;

  // Enumerate remote WIP branches
  let lsRemoteOutput = "";
  try {
    const result = await execFileAsync(
      "git",
      ["-C", repo.repoPath, "ls-remote", "origin", "refs/heads/wip/*"],
      {
        timeout: 15_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        maxBuffer: 1024 * 1024,
      },
    );
    lsRemoteOutput = result.stdout;
  } catch {
    // ls-remote failed (no remote, no auth, etc.) — return empty list
    return NextResponse.json({ wips: [] });
  }

  // Parse: "<sha>\trefs/heads/wip/<label>"
  const branches: string[] = [];
  for (const line of lsRemoteOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 2) continue;
    const ref = parts[1]!;
    const branchName = ref.replace(/^refs\/heads\//, "");
    if (!branchName.startsWith("wip/")) continue;
    branches.push(branchName);
  }

  // For each branch, fetch the commit subject to extract source + timestamp
  const wips: WipEntry[] = [];
  const labelRe = /^wip\/(.+)$/;
  const subjectRe = /^WIP from (.+?) · (\d{4}-\d{2}-\d{2}T[\d:.Z]+)$/;

  for (const branch of branches) {
    const isOwn = branch === ownWipBranch;
    if (isOwn && !includeMine) continue;

    const machineLabel = labelRe.exec(branch)?.[1] ?? branch;

    let source: string | null = null;
    let timestamp: string | null = null;

    try {
      const logResult = await execFileAsync(
        "git",
        ["-C", repo.repoPath, "log", "-1", "--format=%s", `origin/${branch}`],
        {
          timeout: 5_000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          maxBuffer: 256 * 1024,
        },
      );
      const subject = logResult.stdout.trim();
      const match = subjectRe.exec(subject);
      if (match) {
        source = match[1] ?? null;
        timestamp = match[2] ?? null;
      }
    } catch {
      // Could not read log — still include branch with null metadata
    }

    wips.push({ branch, source, machineLabel, timestamp, isOwn });
  }

  // Sort: most recent first (by timestamp descending, nulls last)
  wips.sort((a, b) => {
    if (!a.timestamp && !b.timestamp) return 0;
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return b.timestamp.localeCompare(a.timestamp);
  });

  return NextResponse.json({ wips });
}
