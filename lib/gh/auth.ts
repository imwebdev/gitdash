import { spawn } from "node:child_process";
import { runGh, GitCommandError } from "@/lib/git/exec";

const DEVICE_CODE_RE = /code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i;
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export type AuthState =
  | { state: "pending"; deviceCode: string; verificationUri: string }
  | { state: "success"; login: string }
  | { state: "failed"; error: string };

interface SessionInternal {
  state: AuthState;
  startedAt: number;
}

const sessions = new Map<string, SessionInternal>();

const VERIFICATION_URI = "https://github.com/login/device";

function newRunId(): string {
  return `gh-auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface StartResult {
  runId: string;
  deviceCode: string;
  verificationUri: string;
}

/**
 * Spawn a `gh auth ...` command that drives the OAuth device flow and parse
 * the device code from its stderr. Resolves once the device code is available
 * so the UI can show it immediately. The OAuth completion runs in the
 * background and is observable via `getAuthState(runId)`.
 *
 * Used for both initial login (`gh auth login --web`) and scope upgrades
 * (`gh auth refresh -s <scopes>`) — the device-flow output format is the
 * same in both cases.
 *
 * Throws if `gh` itself can't be spawned (not installed, not on PATH).
 */
function spawnGhAuthDeviceFlow(ghArgs: string[]): Promise<StartResult> {
  return new Promise((resolve, reject) => {
    const runId = newRunId();
    let stderrBuf = "";
    let codeFound = false;
    let stdinClosed = false;
    let settled = false;

    let child;
    try {
      child = spawn("gh", ghArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
    } catch (err) {
      reject(err);
      return;
    }

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT" && !settled) {
        settled = true;
        reject(
          new Error(
            "GitHub CLI (gh) is not installed in this environment. The gitdash installer should have installed it — please run the installer again, or contact support.",
          ),
        );
        return;
      }
      if (!settled) {
        settled = true;
        reject(err);
      }
      sessions.set(runId, {
        state: { state: "failed", error: err.message },
        startedAt: Date.now(),
      });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").replace(ANSI_RE, "");
      stderrBuf += text;

      if (!codeFound) {
        const m = DEVICE_CODE_RE.exec(text) ?? DEVICE_CODE_RE.exec(stderrBuf);
        if (m && m[1]) {
          codeFound = true;
          const deviceCode = m[1].toUpperCase();
          sessions.set(runId, {
            state: {
              state: "pending",
              deviceCode,
              verificationUri: VERIFICATION_URI,
            },
            startedAt: Date.now(),
          });
          if (!settled) {
            settled = true;
            resolve({ runId, deviceCode, verificationUri: VERIFICATION_URI });
          }
        }
      }

      // gh prompts "Press Enter to open ... in your browser". Send a newline
      // so it stops blocking; the UI is what actually opens the browser.
      if (!stdinClosed && /press enter/i.test(text)) {
        try {
          child.stdin.write("\n");
        } catch {
          /* ignore */
        }
      }
    });

    child.stdout.on("data", () => {
      /* discard - everything useful goes to stderr */
    });

    child.on("exit", (code) => {
      stdinClosed = true;
      try {
        child.stdin.end();
      } catch {
        /* ignore */
      }

      if (code === 0) {
        sessions.set(runId, {
          state: { state: "success", login: "" },
          startedAt: Date.now(),
        });
      } else {
        const errMsg = stderrBuf.trim() || `gh exited with code ${code}`;
        sessions.set(runId, {
          state: { state: "failed", error: errMsg },
          startedAt: Date.now(),
        });
        if (!settled) {
          settled = true;
          reject(new Error(errMsg));
        }
      }
    });

    // Safety: if no device code arrives within 30s, give up so the UI doesn't
    // hang forever waiting on a misbehaving gh binary.
    setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        reject(
          new Error(
            "Timed out waiting for GitHub CLI to start the device-code flow.",
          ),
        );
      }
    }, 30_000).unref();
  });
}

/**
 * Initial sign-in for an unauthenticated machine. Drives `gh auth login`
 * through the OAuth device flow.
 */
export function startGhAuthLogin(): Promise<StartResult> {
  return spawnGhAuthDeviceFlow([
    "auth",
    "login",
    "--web",
    "--hostname",
    "github.com",
    "--git-protocol",
    "https",
  ]);
}

/**
 * Scope upgrade for an already-authenticated machine. `gh auth refresh -s`
 * goes through the same device flow but the GitHub authorize page asks the
 * user to grant the additional scopes on top of what they already have.
 *
 * This is what powers the "Connect GitHub" button on the
 * `gh-missing-repo-scope` health warning.
 */
export function startGhAuthRefresh(scopes: string[]): Promise<StartResult> {
  if (scopes.length === 0) {
    return Promise.reject(
      new Error("startGhAuthRefresh requires at least one scope"),
    );
  }
  return spawnGhAuthDeviceFlow([
    "auth",
    "refresh",
    "--hostname",
    "github.com",
    "-s",
    scopes.join(","),
  ]);
}

export function getAuthState(runId: string): AuthState | undefined {
  return sessions.get(runId)?.state;
}

/**
 * Returns the current GitHub login if `gh` is authenticated, or null.
 * Used to short-circuit the sign-in flow when the user is already logged in.
 */
export async function isGhAuthenticated(): Promise<string | null> {
  try {
    const { stdout } = await runGh(["api", "user", "--jq", ".login"], {
      timeoutMs: 10_000,
    });
    const login = stdout.trim();
    return login || null;
  } catch {
    return null;
  }
}

/**
 * Returns the OAuth scopes currently granted to `gh`'s stored token. Parses
 * the `Token scopes:` line from `gh auth status`. Returns an empty array if
 * gh isn't authenticated, isn't installed, or the line can't be parsed.
 */
export async function getGhAuthScopes(): Promise<string[]> {
  // `gh auth status` writes the scope line to stderr by design and exits 0
  // when authenticated. When not authenticated it exits 1 — runGh throws a
  // GitCommandError in that case, but the error carries the captured output
  // so we can still parse from it (and return [] if the line isn't there).
  let text: string;
  try {
    const { stdout, stderr } = await runGh(["auth", "status"], {
      timeoutMs: 10_000,
    });
    text = `${stdout}\n${stderr}`;
  } catch (err) {
    if (err instanceof GitCommandError) {
      text = `${err.stdout}\n${err.stderr}`;
    } else {
      return [];
    }
  }
  const m = text.match(/Token scopes?:\s*(.+)/i);
  if (!m || !m[1]) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

/**
 * Garbage-collect sessions older than 30 minutes so the in-memory map
 * doesn't grow unbounded across long-lived processes.
 */
setInterval(
  () => {
    const cutoff = Date.now() - 30 * 60_000;
    for (const [id, s] of sessions.entries()) {
      if (s.startedAt < cutoff) sessions.delete(id);
    }
  },
  5 * 60_000,
).unref?.();
