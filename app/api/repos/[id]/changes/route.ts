import { NextResponse } from "next/server";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { bootstrap } from "@/lib/bootstrap";
import { getRepoById } from "@/lib/db/repos";
import { runGit } from "@/lib/git/exec";
import { scanFiles, type SecretFinding } from "@/lib/security/secrets";

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

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10 MB
const MAX_ENTRIES = 500;

interface ChangeEntry {
  path: string;
  status: string;
  sizeBytes: number;
  reason: "secret" | "large" | null;
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
  const repoRoot = path.resolve(repo.repoPath);
  const repoRootPrefix = repoRoot.endsWith(path.sep) ? repoRoot : repoRoot + path.sep;

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

    // Resolve and verify the path stays inside the repo root before stat'ing.
    // Defends against symlink-farm or crafted repo state leaking file metadata
    // from outside the repo. lstat (not stat) so symlinks report their own
    // size instead of following to a target we don't want to touch.
    let sizeBytes = 0;
    const absPath = path.resolve(repoRoot, filePath);
    const insideRepo = absPath === repoRoot || absPath.startsWith(repoRootPrefix);
    if (insideRepo) {
      try {
        const s = await lstat(absPath);
        sizeBytes = s.isFile() ? s.size : 0;
      } catch {
        sizeBytes = 0;
      }
    }

    let reason: ChangeEntry["reason"] = null;
    if (matchesSecret) reason = "secret";
    else if (sizeBytes > LARGE_FILE_THRESHOLD) reason = "large";

    entries.push({ path: filePath, status, sizeBytes, reason });
  }

  const suspicious = entries.filter((e) => e.reason !== null);

  // Run secret scan on the files that would be staged
  let secretFindings: SecretFinding[] = [];
  const relativePaths = entries
    .filter((e) => e.status !== "D " && e.status !== " D" && e.status !== "DD")
    .map((e) => e.path);
  try {
    secretFindings = await scanFiles(repo.repoPath, relativePaths);
  } catch {
    // best-effort — don't block the preview if scan errors
  }

  return NextResponse.json({
    files: entries,
    total: chunks.length,
    suspicious,
    truncated,
    secretFindings,
  });
}
