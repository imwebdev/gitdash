/**
 * scripts/mark-reviewed.ts
 *
 * Records the current HEAD SHA as the last-reviewed point for a repo.
 * Usage:  tsx scripts/mark-reviewed.ts [--cwd <path>]
 * Called by:  bin/gitdash mark-reviewed [--cwd <path>]
 *
 * Exits 0 always — never pollutes hook output with errors.
 */

import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

// ── CLI arg parsing ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let inputDir = process.env.PWD ?? process.cwd();

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--cwd" && args[i + 1]) {
    inputDir = args[i + 1]!;
    break;
  }
}

// ── Resolve git root ──────────────────────────────────────────────────────────

function findGitRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 50; i++) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

async function main(): Promise<void> {
  const gitRoot = findGitRoot(inputDir);
  if (!gitRoot) return;

  // Get current HEAD SHA
  let headSha: string;
  try {
    const { stdout } = await execFileAsync("git", ["-C", gitRoot, "rev-parse", "HEAD"]);
    headSha = stdout.trim();
    if (!headSha) return;
  } catch {
    return;
  }

  // Use getDb (write connection) since this is an explicit write operation
  // Inline the DB path logic to avoid pulling in the full bootstrap chain
  const DB_PATH =
    process.env.GITDASH_DB ??
    path.join(
      process.env.HOME ?? ".",
      ".local",
      "state",
      "gitdash",
      "gitdash.sqlite",
    );

  if (!existsSync(DB_PATH)) return;

  // Dynamically import getDb — this triggers migrations which is fine
  // (idempotent) and ensures the new columns exist before we write.
  const { getDb } = await import("../lib/db/schema.js");
  const db = getDb();

  const repo = db
    .prepare<[string], { id: number }>(
      "SELECT id FROM repos WHERE repo_path = ? AND deleted_at IS NULL",
    )
    .get(gitRoot);

  if (!repo) return;

  const now = Date.now();
  db.prepare(
    "UPDATE repos SET last_review_at = ?, reviewed_head_sha = ? WHERE id = ?",
  ).run(now, headSha, repo.id);
}

main().catch(() => {
  // Silent on all errors — runs in hook context
});

process.on("unhandledRejection", () => {
  // Stay silent
});
