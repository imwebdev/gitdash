import { spawn } from "node:child_process";
import { runGh } from "@/lib/git/exec";

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
 * Spawn `gh auth login --web` and parse the device code from its stderr.
 * Resolves once the device code is available so the UI can show it
 * immediately. The OAuth completion runs in the background and is observable
 * via `getAuthState(runId)`.
 *
 * Throws if `gh` itself can't be spawned (not installed, not on PATH).
 */
export function startGhAuthLogin(): Promise<StartResult> {
  return new Promise((resolve, reject) => {
    const runId = newRunId();
    let stderrBuf = "";
    let codeFound = false;
    let stdinClosed = false;
    let settled = false;

    let child;
    try {
      child = spawn(
        "gh",
        [
          "auth",
          "login",
          "--web",
          "--hostname",
          "github.com",
          "--git-protocol",
          "https",
        ],
        { stdio: ["pipe", "pipe", "pipe"], env: process.env },
      );
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
