import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GhStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  user: string | null;
  scopes: string[];
  hasRepoScope: boolean;
}

export interface GitStatus {
  installed: boolean;
  version: string | null;
}

export type HealthWarningCode =
  | "gh-not-installed"
  | "gh-not-authenticated"
  | "gh-missing-repo-scope"
  | "git-not-installed";

export interface HealthWarning {
  severity: "error" | "warning";
  code: HealthWarningCode;
  message: string;
  // When set, the UI should expose a button that opens the in-UI sign-in
  // modal instead of a copy-paste shell command (NORTH STAR: no terminal).
  action: "open-sign-in" | null;
  installHints?: string[];
}

export interface HealthResult {
  gh: GhStatus;
  git: GitStatus;
  warnings: HealthWarning[];
}

async function runWithTimeout(cmd: string, args: string[], timeoutMs = 5_000): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return { ok: true, stdout: stdout.toString(), stderr: stderr.toString(), code: 0 };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; killed?: boolean };
    return {
      ok: false,
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      stderr: typeof e.stderr === "string" ? e.stderr : "",
      code: typeof e.code === "number" ? e.code : -1,
    };
  }
}

async function checkGh(): Promise<GhStatus> {
  const versionRes = await runWithTimeout("gh", ["--version"]);
  if (!versionRes.ok && versionRes.code === -1) {
    // ENOENT or timeout
    return {
      installed: false,
      version: null,
      authenticated: false,
      user: null,
      scopes: [],
      hasRepoScope: false,
    };
  }
  const versionLine = versionRes.stdout.split("\n")[0]?.trim() ?? null;

  // gh auth status writes to stderr by design. -t prints the token; we never
  // look at it (it would be a security smell to log) but the flag also makes
  // the command emit the scope list, which we DO need.
  const authRes = await runWithTimeout("gh", ["auth", "status"]);
  if (!authRes.ok) {
    return {
      installed: true,
      version: versionLine,
      authenticated: false,
      user: null,
      scopes: [],
      hasRepoScope: false,
    };
  }

  // Sample stderr block from `gh auth status`:
  //   github.com
  //     ✓ Logged in to github.com account imwebdev (keyring)
  //     ✓ Token scopes: 'repo', 'workflow', 'gist', 'read:org'
  // Parse out user + scopes.
  const text = `${authRes.stdout}\n${authRes.stderr}`;
  const userMatch = text.match(/Logged in to github\.com (?:account )?(\S+)/i);
  const scopeMatch = text.match(/Token scopes?:\s*(.+)/i);
  const scopes = scopeMatch && scopeMatch[1]
    ? scopeMatch[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean)
    : [];

  return {
    installed: true,
    version: versionLine,
    authenticated: true,
    user: userMatch ? (userMatch[1] ?? null) : null,
    scopes,
    hasRepoScope: scopes.includes("repo"),
  };
}

async function checkGit(): Promise<GitStatus> {
  const res = await runWithTimeout("git", ["--version"]);
  if (!res.ok) return { installed: false, version: null };
  const line = res.stdout.split("\n")[0]?.trim() ?? null;
  return { installed: true, version: line };
}

const GH_INSTALL_HINTS = [
  "macOS: brew install gh",
  "Linux (Debian/Ubuntu): apt install gh",
  "Linux (Fedora/RHEL): dnf install gh",
  "Other: see https://cli.github.com",
];

const GIT_INSTALL_HINTS = [
  "macOS: brew install git (or install Xcode Command Line Tools)",
  "Linux (Debian/Ubuntu): apt install git",
  "Other: see https://git-scm.com",
];

function buildWarnings(gh: GhStatus, git: GitStatus): HealthWarning[] {
  const warnings: HealthWarning[] = [];

  if (!git.installed) {
    warnings.push({
      severity: "error",
      code: "git-not-installed",
      message: "Git isn't installed on this machine. gitdash can't read repo state without it.",
      action: null,
      installHints: GIT_INSTALL_HINTS,
    });
  }

  if (!gh.installed) {
    warnings.push({
      severity: "error",
      code: "gh-not-installed",
      message: "GitHub CLI ('gh') isn't installed. Without it, gitdash can't talk to GitHub — no comparisons, no clone, no publish.",
      action: null,
      installHints: GH_INSTALL_HINTS,
    });
  } else if (!gh.authenticated) {
    warnings.push({
      severity: "warning",
      code: "gh-not-authenticated",
      message: "GitHub CLI isn't connected to your account yet. Click below to sign in — no terminal needed.",
      action: "open-sign-in",
    });
  } else if (!gh.hasRepoScope) {
    warnings.push({
      severity: "warning",
      code: "gh-missing-repo-scope",
      message: "GitHub access is missing the 'repo' scope, so push/clone may fail. Re-running sign-in will request the right scopes.",
      action: "open-sign-in",
    });
  }

  return warnings;
}

export async function checkHealth(): Promise<HealthResult> {
  const [gh, git] = await Promise.all([checkGh(), checkGit()]);
  return { gh, git, warnings: buildWarnings(gh, git) };
}
