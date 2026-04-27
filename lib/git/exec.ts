import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "log",
  "config",
  "rev-parse",
  "rev-list",
  "branch",
  "show-ref",
  "for-each-ref",
  "diff",
  "ls-files",
  "ls-remote",
  "symbolic-ref",
]);

const MUTATING_GIT_SUBCOMMANDS = new Set([
  "pull",
  "push",
  "fetch",
  "merge",
  "stash",
  "rebase",
  "add",
  "commit",
  "checkout",
  "cherry-pick",
  "reset",
]);

export type GitRunMode = "read" | "mutate";

export class GitCommandError extends Error {
  readonly code: number | null;
  readonly stderr: string;
  readonly stdout: string;
  constructor(args: string[], code: number | null, stdout: string, stderr: string) {
    super(`git ${args.join(" ")} exited ${code}: ${stderr.trim() || stdout.trim()}`);
    this.name = "GitCommandError";
    this.code = code;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

const SAFE_REF_RE = /^[a-zA-Z0-9._/-]{1,200}$/;

export function isSafeRef(ref: string): boolean {
  return SAFE_REF_RE.test(ref);
}

export function assertSafeRef(ref: string): void {
  if (!isSafeRef(ref)) {
    throw new Error(`unsafe git ref: ${JSON.stringify(ref)}`);
  }
}

export async function assertInsideAllowedRoot(repoPath: string, allowedRoots: readonly string[]): Promise<string> {
  const resolved = path.resolve(repoPath);
  let real: string;
  try {
    real = await realpath(resolved);
  } catch {
    real = resolved;
  }
  for (const root of allowedRoots) {
    const realRoot = path.resolve(root);
    if (real === realRoot || real.startsWith(realRoot + path.sep)) {
      return real;
    }
  }
  throw new Error(`repo path not in allowed roots: ${real}`);
}

export interface GitRunOptions {
  cwd: string;
  mode: GitRunMode;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export async function runGit(args: string[], opts: GitRunOptions): Promise<{ stdout: string; stderr: string }> {
  if (args.length === 0) throw new Error("git args must not be empty");
  const sub = args[0]!;
  if (opts.mode === "read") {
    if (!READ_ONLY_GIT_SUBCOMMANDS.has(sub)) {
      throw new Error(`git subcommand not allowed in read mode: ${sub}`);
    }
  } else {
    if (!MUTATING_GIT_SUBCOMMANDS.has(sub)) {
      throw new Error(`git subcommand not allowed in mutate mode: ${sub}`);
    }
  }
  try {
    const result = await execFileAsync("git", ["-C", opts.cwd, ...args], {
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: 8 * 1024 * 1024,
      env: opts.env ?? process.env,
    });
    return { stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    throw new GitCommandError(args, e.code ?? null, e.stdout ?? "", e.stderr ?? String(err));
  }
}

export async function runGh(args: string[], opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync("gh", args, {
      timeout: opts.timeoutMs ?? 15_000,
      maxBuffer: 4 * 1024 * 1024,
      env: opts.env ?? process.env,
    });
    return { stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    throw new GitCommandError(["gh", ...args], e.code ?? null, e.stdout ?? "", e.stderr ?? String(err));
  }
}
