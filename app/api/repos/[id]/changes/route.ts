import { NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import path from "node:path";
import { bootstrap } from "@/lib/bootstrap";
import { getRepoById } from "@/lib/db/repos";
import { runGit } from "@/lib/git/exec";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUSPICIOUS_NAME_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,
  /\.key$/i,
  /\.pem$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /credentials?/i,
  /secrets?/i,
  /\.p12$/i,
  /\.pfx$/i,
];

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10 MB — user warning
const OVERSIZED_THRESHOLD = 100 * 1024 * 1024; // 100 MB — GitHub's hard limit, block
const MAX_ENTRIES = 500;

interface ChangeEntry {
  path: string;
  status: string;
  sizeBytes: number;
  reason: "secret" | "large" | "oversized" | null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
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

  let stdout: string;
  try {
    const result = await runGit(["status", "--porcelain=v1", "-z"], {
      cwd: repo.repoPath,
      mode: "read",
      timeoutMs: 15_000,
    });
    stdout = result.stdout;
  } catch {
    return NextResponse.json({ files: [], total: 0, suspicious: [], truncated: false });
  }

  const entries: ChangeEntry[] = [];
  const chunks = stdout.split("\0").filter(Boolean);
  let truncated = false;

  for (const raw of chunks) {
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    if (raw.length < 4) continue; // need 'XY <space> <path>'
    const status = raw.slice(0, 2);
    const filePath = raw.slice(3);
    if (!filePath) continue;

    const baseName = path.basename(filePath);
    const matchesSecret = SUSPICIOUS_NAME_PATTERNS.some((re) => re.test(baseName));

    let sizeBytes = 0;
    try {
      const s = await stat(path.join(repo.repoPath, filePath));
      sizeBytes = s.isFile() ? s.size : 0;
    } catch {
      sizeBytes = 0;
    }

    // Classification order matters: oversized is a hard block (GitHub will
    // reject the push), so it wins over the informational "secret"/"large"
    // reasons. The user needs the oversized signal at the top of the UI.
    let reason: ChangeEntry["reason"] = null;
    if (sizeBytes >= OVERSIZED_THRESHOLD) reason = "oversized";
    else if (matchesSecret) reason = "secret";
    else if (sizeBytes > LARGE_FILE_THRESHOLD) reason = "large";

    entries.push({ path: filePath, status, sizeBytes, reason });
  }

  // Suspicious = advisory warnings (secrets / large-but-pushable). Oversized
  // files live in a separate bucket because they're a hard block, not a
  // "heads up".
  const suspicious = entries.filter(
    (e) => e.reason === "secret" || e.reason === "large",
  );

  return NextResponse.json({
    files: entries,
    total: chunks.length,
    suspicious,
    truncated,
  });
}
