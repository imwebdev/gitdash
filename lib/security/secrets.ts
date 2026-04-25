/**
 * Pre-push secret scanner.
 *
 * Rules: named regex patterns. No external dependencies — pure Node built-ins.
 * Never log or return full secrets. All matches are truncated to 40 chars + ellipsis.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface SecretFinding {
  filePath: string;
  line: number;
  ruleId: string;
  ruleName: string;
  /** First 40 chars of the matched text + ellipsis if truncated. Never the full secret. */
  snippet: string;
}

interface Rule {
  id: string;
  name: string;
  /** Tested against each line of the file content. Must have no global flag. */
  pattern: RegExp;
}

/** Truncate a matched value to at most 40 printable chars + ellipsis. */
function safeSnippet(match: string): string {
  const clean = match.replace(/[\r\n]/g, " ");
  return clean.length > 40 ? clean.slice(0, 40) + "…" : clean;
}

/** Shannon entropy in bits per character over `str`. */
function shannonEntropy(str: string): number {
  if (str.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of str) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Lockfiles to skip by exact basename.
 * Hex blobs in lockfiles are content-addressed hashes, not secrets.
 */
const LOCKFILE_NAMES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "composer.lock",
]);

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB
const BINARY_PROBE_BYTES = 8 * 1024; // 8 KB

/**
 * Ordered rule set. Each rule is applied to every non-skipped line.
 * Patterns have no global flag so match() returns the first occurrence.
 */
const RULES: readonly Rule[] = Object.freeze([
  {
    id: "openai-key",
    name: "OpenAI API key",
    // sk- followed by 48 alphanumerics
    pattern: /sk-[A-Za-z0-9]{48}/,
  },
  {
    id: "anthropic-key",
    name: "Anthropic API key",
    // sk-ant- prefix used by Anthropic
    pattern: /sk-ant-[A-Za-z0-9\-_]{20,}/,
  },
  {
    id: "aws-access-key",
    name: "AWS access key ID",
    // AKIA or ASIA prefix, 16 uppercase alphanumerics
    pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/,
  },
  {
    id: "aws-secret-key",
    name: "AWS secret access key",
    // 40-char base64 value preceded by common env var names
    pattern: /(?:aws_secret|AWS_SECRET)[_A-Za-z]*\s*[=:]\s*["']?[A-Za-z0-9/+]{40}["']?/i,
  },
  {
    id: "github-token",
    name: "GitHub personal access token",
    // Classic: ghp_, fine-grained: github_pat_
    pattern: /(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})/,
  },
  {
    id: "github-oauth",
    name: "GitHub OAuth token",
    pattern: /gho_[A-Za-z0-9]{36}/,
  },
  {
    id: "github-app-token",
    name: "GitHub App token",
    pattern: /(?:ghs_|ghu_)[A-Za-z0-9]{36}/,
  },
  {
    id: "stripe-secret",
    name: "Stripe secret key",
    pattern: /sk_(?:live|test)_[A-Za-z0-9]{24,}/,
  },
  {
    id: "stripe-restricted",
    name: "Stripe restricted key",
    pattern: /rk_(?:live|test)_[A-Za-z0-9]{24,}/,
  },
  {
    id: "private-key-block",
    name: "PEM private key block",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    id: "slack-token",
    name: "Slack API token",
    // xox[bpars]-... format
    pattern: /xox[bpars]-[A-Za-z0-9\-]{10,}/,
  },
  {
    id: "slack-webhook",
    name: "Slack webhook URL",
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/,
  },
  {
    id: "google-api-key",
    name: "Google API key",
    pattern: /AIza[A-Za-z0-9\-_]{35}/,
  },
  {
    id: "gcp-service-account",
    name: "GCP service account key",
    pattern: /"type"\s*:\s*"service_account"/,
  },
  {
    id: "jwt-token",
    name: "JWT token",
    // eyJ... three base64url segments
    pattern: /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/,
  },
  {
    id: "generic-secret-var",
    name: "Generic secret/password variable",
    // Catches: SECRET=foo, PASSWORD=bar, TOKEN=baz (value 8+ non-whitespace chars)
    pattern: /(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|APIKEY)\s*[=:]\s*["']?(?!\s*$)\S{8,}["']?/i,
  },
  {
    id: "high-entropy-env",
    name: "High-entropy .env value",
    // Checked separately via entropy logic below — this pattern matches .env-style assignments
    // and a secondary entropy gate filters out low-entropy values.
    pattern: /^[A-Z][A-Z0-9_]*\s*=\s*["']?([^\s"'#]{16,})["']?\s*(?:#.*)?$/,
  },
] as Rule[]);

/** The rule that gates on entropy — checked separately. */
const HIGH_ENTROPY_RULE_ID = "high-entropy-env";
const ENTROPY_THRESHOLD = 4.0;

/**
 * Scan the text of a single file for secret patterns.
 * Returns an array of findings. Never includes full secret values.
 *
 * @param text     Full text content of the file.
 * @param filePath Relative or display path (used in findings only).
 */
export function scanContent(text: string, filePath: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNumber = i + 1;
    const seenRulesThisLine = new Set<string>();

    for (const rule of RULES) {
      if (seenRulesThisLine.has(rule.id)) continue;

      const m = rule.pattern.exec(line);
      if (!m) continue;

      // Special entropy gate for the .env-style rule
      if (rule.id === HIGH_ENTROPY_RULE_ID) {
        // m[1] is the captured value group
        const value = m[1];
        if (!value) continue;
        if (shannonEntropy(value) <= ENTROPY_THRESHOLD) continue;
      }

      seenRulesThisLine.add(rule.id);
      findings.push({
        filePath,
        line: lineNumber,
        ruleId: rule.id,
        ruleName: rule.name,
        snippet: safeSnippet(m[0]),
      });
    }
  }

  return findings;
}

/**
 * Scan a set of files in a repo for secrets.
 * Skips lockfiles, binary files (null byte in first 8 KB), and files > 1 MB.
 *
 * @param repoPath      Absolute path to the repo root.
 * @param relativePaths Paths relative to repoPath.
 */
export async function scanFiles(
  repoPath: string,
  relativePaths: string[],
): Promise<SecretFinding[]> {
  const findings: SecretFinding[] = [];
  const repoRoot = path.resolve(repoPath);
  const repoRootPrefix = repoRoot.endsWith(path.sep) ? repoRoot : repoRoot + path.sep;

  for (const rel of relativePaths) {
    const baseName = path.basename(rel);

    // Skip lockfiles
    if (LOCKFILE_NAMES.has(baseName)) continue;

    const absPath = path.resolve(repoRoot, rel);
    // Guard against path traversal
    if (absPath !== repoRoot && !absPath.startsWith(repoRootPrefix)) continue;

    // Skip files > 1 MB (stat before reading)
    let fileSize = 0;
    try {
      const s = await stat(absPath);
      if (!s.isFile()) continue;
      fileSize = s.size;
    } catch {
      continue; // file may have been deleted between status and scan
    }
    if (fileSize > MAX_FILE_SIZE) continue;

    // Read file; skip binary files (null byte in first 8 KB)
    let content: string;
    try {
      const buf = await readFile(absPath);
      // Check for binary: null byte in first 8 KB
      const probe = buf.subarray(0, BINARY_PROBE_BYTES);
      if (probe.includes(0)) continue;
      content = buf.toString("utf8");
    } catch {
      continue;
    }

    const fileFindings = scanContent(content, rel);
    findings.push(...fileFindings);
  }

  return findings;
}
