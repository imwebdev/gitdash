import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

/** Owner/name segments that aren't filesystem booby-traps. */
const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface CloneResult {
  ok: boolean;
  destination: string;
  /** Truncated combined stdout/stderr — surfaced to the client on failure. */
  output: string;
}

export class CloneError extends Error {
  readonly destination: string;
  readonly output: string;
  constructor(message: string, destination: string, output: string) {
    super(message);
    this.name = "CloneError";
    this.destination = destination;
    this.output = output;
  }
}

/**
 * Resolve the directory new repos clone into. Order:
 *   1. explicit `cloneDir` argument (passed by caller after reading config)
 *   2. $HOME/repos (sensible default for non-technical users — visible)
 */
export function resolveCloneDir(configValue: string | undefined): string {
  if (configValue && configValue.trim().length > 0) {
    // Resolve ~ if user wrote it as a literal in config.json
    if (configValue.startsWith("~/")) {
      return path.join(os.homedir(), configValue.slice(2));
    }
    return path.resolve(configValue);
  }
  return path.join(os.homedir(), "repos");
}

/**
 * Clone owner/name into <cloneDir>/<name>. Synchronous-ish — awaits the gh
 * subprocess to finish (5-min timeout). For monorepos > a few hundred MB the
 * user is better off shelling out to `gh repo clone` themselves.
 */
export async function cloneGithubRepo(opts: {
  owner: string;
  name: string;
  cloneDir: string;
}): Promise<CloneResult> {
  const { owner, name, cloneDir } = opts;

  if (!SAFE_SEGMENT_RE.test(owner)) {
    throw new CloneError(`invalid owner '${owner}'`, "", "");
  }
  if (!SAFE_SEGMENT_RE.test(name)) {
    throw new CloneError(`invalid repo name '${name}'`, "", "");
  }

  // Refuse anything that resolves outside the user's home tree. Defence in
  // depth in case config.json contains a hostile cloneDir.
  const homeDir = os.homedir();
  const targetDir = path.resolve(cloneDir);
  if (!targetDir.startsWith(homeDir + path.sep) && targetDir !== homeDir) {
    throw new CloneError(
      `cloneDir must be inside your home directory; got ${targetDir}`,
      targetDir,
      "",
    );
  }

  await mkdir(targetDir, { recursive: true });
  const destination = path.join(targetDir, name);

  // If something already exists at that path (.git or otherwise), bail —
  // never overwrite. The user can move/delete and try again.
  try {
    await stat(destination);
    throw new CloneError(
      `${destination} already exists`,
      destination,
      "",
    );
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") {
      // any error that isn't "not found" — including our CloneError above —
      // propagates
      throw err;
    }
  }

  const slug = `${owner}/${name}`;
  try {
    const { stdout, stderr } = await execFileAsync(
      "gh",
      ["repo", "clone", slug, destination],
      { timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return {
      ok: true,
      destination,
      output: ((stdout ?? "") + (stderr ?? "")).slice(0, 4000),
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    const output = ((e.stdout ?? "") + (e.stderr ?? "") + (e.message ?? ""))
      .slice(0, 4000);
    throw new CloneError(
      `gh repo clone ${slug} failed (exit ${e.code ?? "?"})`,
      destination,
      output,
    );
  }
}
