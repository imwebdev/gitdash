/**
 * Shared filter for staged-file scanners.
 *
 * Rules (same for all scanners — secret-scan, prompt-injection, etc.):
 *  - Skip files > 1 MB
 *  - Skip binary files (null byte in first 8 KB)
 *  - Skip known lockfiles by name
 *  - Skip deleted files (nothing to read)
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const LOCK_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "composer.lock",
]);

const MAX_SCAN_SIZE = 1 * 1024 * 1024; // 1 MB
const BINARY_PROBE = 8 * 1024; // 8 KB

export interface StagedFile {
  /** Relative path inside the repo */
  relPath: string;
  /** Absolute path on disk */
  absPath: string;
  /** Raw UTF-8 content of the file */
  content: string;
}

/**
 * Given a list of relative paths (as returned by `git status --porcelain`),
 * resolve them against `repoRoot`, apply all skip filters, read the content,
 * and return only the files that should be scanned.
 *
 * `deletedPaths` should be the set of paths whose porcelain status starts with
 * 'D' — those files don't exist on disk and must be excluded.
 */
export async function readStagedFiles(
  relPaths: string[],
  repoRoot: string,
  deletedPaths: Set<string>,
): Promise<StagedFile[]> {
  const repoRootNorm = repoRoot.endsWith(path.sep) ? repoRoot : repoRoot + path.sep;
  const results: StagedFile[] = [];

  for (const relPath of relPaths) {
    if (deletedPaths.has(relPath)) continue;

    const baseName = path.basename(relPath);
    if (LOCK_FILES.has(baseName)) continue;

    const absPath = path.resolve(repoRoot, relPath);
    // Path traversal guard
    if (absPath !== repoRoot && !absPath.startsWith(repoRootNorm)) continue;

    let buf: Buffer;
    try {
      buf = await readFile(absPath);
    } catch {
      continue;
    }

    if (buf.length > MAX_SCAN_SIZE) continue;

    // Binary probe — null byte in first 8 KB
    const probe = buf.subarray(0, BINARY_PROBE);
    if (probe.includes(0)) continue;

    results.push({ relPath, absPath, content: buf.toString("utf8") });
  }

  return results;
}
