/**
 * npm audit scanner for the commit-push preview modal.
 *
 * Runs `npm audit --json --audit-level=high` in the repo directory when
 * package.json or package-lock.json is among the staged files.
 *
 * Results are cached in memory keyed by SHA-256 of the lockfile (or
 * package.json if no lockfile), with a 1-hour TTL. No SQLite persistence
 * needed — the cache survives for the lifetime of the Node process.
 *
 * Only npm is supported in v1.
 * TODO: add yarn/pnpm/bun support in a future iteration.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditFinding {
  name: string;
  severity: "high" | "critical";
  title: string;
  via: string[];
}

interface CacheEntry {
  findings: AuditFinding[];
  ts: number;
}

// ---------------------------------------------------------------------------
// Internal cache
// ---------------------------------------------------------------------------

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour

function cacheGet(key: string): AuditFinding[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.findings;
}

function cacheSet(key: string, findings: AuditFinding[]): void {
  cache.set(key, { findings, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// npm audit runner
// ---------------------------------------------------------------------------

const MAX_FINDINGS = 20;

/**
 * Run `npm audit --json --audit-level=high` in repoPath.
 *
 * Returns an array of high/critical findings (capped at MAX_FINDINGS), or
 * null if:
 *  - neither package.json nor package-lock.json exists in the working tree
 *  - npm is not on PATH
 *  - a non-npm lockfile is present with no package-lock.json (yarn/pnpm/bun)
 *  - the scanner times out or returns an unexpected exit code
 *
 * Never throws; all errors are caught and silently skipped.
 */
export async function runNpmAudit(repoPath: string): Promise<AuditFinding[] | null> {
  // Determine which file to hash for the cache key.
  const lockfilePath = path.join(repoPath, "package-lock.json");
  const packageJsonPath = path.join(repoPath, "package.json");

  let hashSource: Buffer | null = null;
  let hashSourceName = "package-lock.json";

  try {
    hashSource = await readFile(lockfilePath);
  } catch {
    // package-lock.json not present — try package.json
    try {
      hashSource = await readFile(packageJsonPath);
      hashSourceName = "package.json";
    } catch {
      // Neither file exists — skip the audit entirely.
      return null;
    }
  }

  // Check for non-npm lockfiles when there's no package-lock.json.
  // Skip silently — don't show "unsupported lockfile" noise.
  if (hashSourceName === "package.json") {
    const yarnLock = path.join(repoPath, "yarn.lock");
    const pnpmLock = path.join(repoPath, "pnpm-lock.yaml");
    const bunLock = path.join(repoPath, "bun.lock");
    const hasAltLock = await fileExists(yarnLock) || await fileExists(pnpmLock) || await fileExists(bunLock);
    if (hasAltLock) {
      // TODO: add yarn/pnpm/bun audit support in a future iteration.
      return null;
    }
  }

  const cacheKey = createHash("sha256").update(hashSource).digest("hex");
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;

  // Run npm audit.
  const findings = await execNpmAudit(repoPath);
  if (findings === null) return null;

  cacheSet(cacheKey, findings);
  return findings;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileExists(p: string): Promise<boolean> {
  try {
    await readFile(p, { flag: "r" });
    return true;
  } catch {
    return false;
  }
}

/** Raw shape of a vulnerability entry in `npm audit --json` output. */
interface NpmAuditVulnerability {
  severity: string;
  title?: string;
  via?: unknown[];
  [key: string]: unknown;
}

interface NpmAuditJsonOutput {
  vulnerabilities?: Record<string, NpmAuditVulnerability>;
  [key: string]: unknown;
}

async function execNpmAudit(repoPath: string): Promise<AuditFinding[] | null> {
  return new Promise((resolve) => {
    const child = execFile(
      "npm",
      ["audit", "--json", "--audit-level=high"],
      {
        cwd: repoPath,
        timeout: 10_000, // 10 seconds
        maxBuffer: 4 * 1024 * 1024,
        // Inherit process.env so npm resolves correctly on the host.
        env: process.env,
      },
      (err, stdout) => {
        // exit code 0 = no findings, exit code 1 = findings found.
        // Any other code (e.g. npm not found, network error) → skip silently.
        if (err) {
          const code = (err as NodeJS.ErrnoException & { code?: number | string }).code;
          // ENOENT means npm isn't on PATH — skip silently.
          if (code === "ENOENT") {
            resolve(null);
            return;
          }
          // exit code 1 with stdout present means audit found vulnerabilities.
          // Treat it as a successful scan.
          const numericCode = typeof (err as { exitCode?: number }).exitCode === "number"
            ? (err as { exitCode?: number }).exitCode
            : null;
          if (numericCode !== 1) {
            // Unexpected exit code — skip silently.
            resolve(null);
            return;
          }
        }

        try {
          const parsed = JSON.parse(stdout) as NpmAuditJsonOutput;
          const findings = parseFindings(parsed);
          resolve(findings);
        } catch {
          resolve(null);
        }
      },
    );

    // Handle timeout: child.killed will be true if execFile's own timeout
    // triggers, but we handle this redundantly by catching any ETIMEDOUT err
    // above via the generic "unexpected exit code" path.
    child.on("error", () => {
      // Already handled in callback; this prevents unhandled-rejection noise.
    });
  });
}

function parseFindings(json: NpmAuditJsonOutput): AuditFinding[] {
  const vulns = json.vulnerabilities;
  if (!vulns || typeof vulns !== "object") return [];

  const findings: AuditFinding[] = [];

  for (const [name, vuln] of Object.entries(vulns)) {
    if (vuln.severity !== "high" && vuln.severity !== "critical") continue;

    const viaList: string[] = [];
    if (Array.isArray(vuln.via)) {
      for (const v of vuln.via) {
        if (typeof v === "string") {
          viaList.push(v);
        } else if (v && typeof v === "object" && "title" in v && typeof (v as { title?: unknown }).title === "string") {
          viaList.push((v as { title: string }).title);
        }
      }
    }

    // Title: prefer via[0].title if via is an object, else advisory title.
    const title = vuln.title ?? (viaList[0] ?? "No title available");

    findings.push({
      name,
      severity: vuln.severity as "high" | "critical",
      title: typeof title === "string" ? title : String(title),
      via: viaList,
    });

    if (findings.length >= MAX_FINDINGS) break;
  }

  return findings;
}
