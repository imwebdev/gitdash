/**
 * Prompt-injection pattern scanner for staged files.
 *
 * Reads each staged file through the shared staged-files filter and tests
 * every non-empty line against a small set of high-signal regexes.  Returns
 * informational findings only — nothing is blocked.
 *
 * Opt-out: if a file contains the literal string `gitdash:skip-prompt-injection`
 * anywhere in its content, the file is skipped entirely.
 */

import { createHash } from "node:crypto";
import { readStagedFiles } from "./staged-files";

// ---------------------------------------------------------------------------
// Patterns (v1 — conservative, high-signal only)
// ---------------------------------------------------------------------------

const PATTERNS: Array<{ id: PatternId; label: string; re: RegExp }> = [
  {
    id: 1,
    label: "ignore-previous",
    re: /\bignore (the |all |any )?(previous|prior|above) (instructions?|prompts?|messages?|directives?)\b/i,
  },
  {
    id: 2,
    label: "disregard-above",
    re: /\bdisregard (the |all |any )?(above|previous|prior) (instructions?|prompts?|messages?|directives?)\b/i,
  },
  {
    id: 3,
    label: "you-are-now",
    re: /\byou are now (a |an )?[A-Za-z]/i,
  },
  {
    id: 4,
    label: "from-now-on",
    re: /\bfrom now on,?\s*(you (will|are|must|shall)|act as|behave as|pretend (to be|you are))\b/i,
  },
  {
    id: 5,
    label: "forget-everything",
    re: /\b(forget|ignore) (everything|all) (you('?ve| have)? )?(been told|learned|know)\b/i,
  },
];

type PatternId = 1 | 2 | 3 | 4 | 5;

export interface PromptInjectionFinding {
  path: string;
  line: number;
  snippet: string;
  patternId: PatternId;
  patternLabel: string;
}

const SKIP_MARKER = "gitdash:skip-prompt-injection";
const MAX_FINDINGS = 30;
const SNIPPET_MAX = 120;

// ---------------------------------------------------------------------------
// In-memory cache keyed by sha256(file content)
// ---------------------------------------------------------------------------

const cache = new Map<string, PromptInjectionFinding[]>();

function cacheKey(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function scanContent(relPath: string, content: string): PromptInjectionFinding[] {
  if (content.includes(SKIP_MARKER)) return [];

  const key = cacheKey(content);
  const cached = cache.get(key);
  if (cached !== undefined) {
    // Re-map to the current path (path is not part of the cache key)
    return cached.map((f) => ({ ...f, path: relPath }));
  }

  const findings: PromptInjectionFinding[] = [];
  const lines = content.split("\n");

  outer: for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]!;
    for (const pattern of PATTERNS) {
      if (pattern.re.test(lineText)) {
        findings.push({
          path: relPath,
          line: i + 1, // 1-based
          snippet: lineText.trim().slice(0, SNIPPET_MAX),
          patternId: pattern.id,
          patternLabel: pattern.label,
        });
        // One finding per line maximum; move to the next line
        if (findings.length >= MAX_FINDINGS) break outer;
        break;
      }
    }
  }

  // Cache the result without path so it can be reused for other paths with
  // identical content (e.g. copied files).
  cache.set(key, findings.map((f) => ({ ...f, path: "" })));
  return findings;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan staged files for prompt-injection patterns.
 *
 * Never throws — any internal error silently returns an empty array so it
 * cannot block the commit-push preview.
 */
export async function scanForPromptInjection(
  relPaths: string[],
  repoRoot: string,
  deletedPaths: Set<string>,
): Promise<{ findings: PromptInjectionFinding[]; truncated: boolean }> {
  try {
    const stagedFiles = await readStagedFiles(relPaths, repoRoot, deletedPaths);
    const allFindings: PromptInjectionFinding[] = [];
    let truncated = false;

    for (const file of stagedFiles) {
      if (allFindings.length >= MAX_FINDINGS) {
        truncated = true;
        break;
      }
      const fileFindings = scanContent(file.relPath, file.content);
      for (const f of fileFindings) {
        allFindings.push(f);
        if (allFindings.length >= MAX_FINDINGS) {
          truncated = true;
          break;
        }
      }
    }

    return { findings: allFindings, truncated };
  } catch {
    return { findings: [], truncated: false };
  }
}
