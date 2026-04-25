/**
 * scripts/install-hook.ts
 *
 * Installs (or removes) a Claude Code SessionStart hook that runs
 * `gitdash status --cwd $CLAUDE_PROJECT_DIR` at the start of every session.
 *
 * Usage:
 *   gitdash install-hook [--user] [--project] [--dry-run] [--uninstall] [--help]
 *   gitdash install-hook [--path <file>]   # hidden flag for test isolation
 *
 * Env vars:
 *   GITDASH_INSTALL_HOOK_TARGET  override target file (for tests)
 *
 * Exits 0 on success. Exits 1 on hard error (invalid JSON, permission denied).
 * Never writes to shell — pure fs/promises.
 */

import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// ── Canonical hook entry ─────────────────────────────────────────────────────

const CANONICAL_HOOK = {
  matcher: "*",
  hooks: [
    {
      type: "command",
      command: "gitdash status --cwd $CLAUDE_PROJECT_DIR",
    },
  ],
} as const;

// Identification heuristic: any hook command containing "gitdash status"
function isGitdashEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  const hooksArr = Array.isArray(e["hooks"]) ? (e["hooks"] as unknown[]) : [];
  return hooksArr.some((h) => {
    if (!h || typeof h !== "object") return false;
    const cmd = (h as Record<string, unknown>)["command"];
    return typeof cmd === "string" && cmd.includes("gitdash status");
  });
}

// ── CLI arg parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);

let scope: "user" | "project" = "user";
let dryRun = false;
let uninstall = false;
let targetOverride: string | null = process.env["GITDASH_INSTALL_HOOK_TARGET"] ?? null;

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    `Usage: gitdash install-hook [options]

Options:
  --user        Install in ~/.claude/settings.json (default)
  --project     Install in ./.claude/settings.json (current directory)
  --dry-run     Print proposed changes without writing
  --uninstall   Remove the gitdash hook entry
  --help        Show this help

The hook runs "gitdash status --cwd \$CLAUDE_PROJECT_DIR" at the start
of every Claude Code session so you see the repo sync state immediately.
`,
  );
  process.exit(0);
}

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--user") { scope = "user"; }
  else if (a === "--project") { scope = "project"; }
  else if (a === "--dry-run") { dryRun = true; }
  else if (a === "--uninstall") { uninstall = true; }
  else if (a === "--path" && args[i + 1]) {
    targetOverride = args[i + 1]!;
    i++;
  }
}

// ── Resolve target path ──────────────────────────────────────────────────────

function resolveTarget(): string {
  if (targetOverride) return path.resolve(targetOverride);
  if (scope === "project") {
    return path.join(process.cwd(), ".claude", "settings.json");
  }
  const home = process.env["HOME"];
  if (!home) {
    process.stderr.write("[gitdash] $HOME is not set\n");
    process.exit(1);
  }
  return path.join(home, ".claude", "settings.json");
}

const targetPath = resolveTarget();

// ── JSON helpers ─────────────────────────────────────────────────────────────

type SettingsJson = Record<string, unknown>;

async function readSettings(): Promise<SettingsJson | null> {
  // Returns null if file does not exist.
  if (!existsSync(targetPath)) return null;

  let raw: string;
  try {
    raw = await readFile(targetPath, "utf8");
  } catch (err) {
    process.stderr.write(`[gitdash] Cannot read ${targetPath}: ${String(err)}\n`);
    process.exit(1);
  }

  try {
    return JSON.parse(raw) as SettingsJson;
  } catch (err) {
    process.stderr.write(
      `[gitdash] Invalid JSON in ${targetPath}: ${String(err)}\n` +
        `  Fix or delete the file and re-run.\n`,
    );
    process.exit(1);
  }
}

async function writeSettings(settings: SettingsJson): Promise<void> {
  const dir = path.dirname(targetPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(targetPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

async function backup(): Promise<void> {
  if (!existsSync(targetPath)) return; // nothing to back up
  const backupPath = `${targetPath}.gitdash-backup-${Date.now()}`;
  await copyFile(targetPath, backupPath);
  process.stdout.write(`  backed up: ${backupPath}\n`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const existing = await readSettings();

  if (uninstall) {
    await runUninstall(existing);
  } else {
    await runInstall(existing);
  }
}

async function runInstall(existing: SettingsJson | null): Promise<void> {
  // Build working settings object
  const settings: SettingsJson = existing ?? {};

  // Navigate to hooks.SessionStart
  if (!settings["hooks"] || typeof settings["hooks"] !== "object") {
    settings["hooks"] = {};
  }
  const hooks = settings["hooks"] as Record<string, unknown>;

  if (!Array.isArray(hooks["SessionStart"])) {
    hooks["SessionStart"] = [];
  }
  const sessionStart = hooks["SessionStart"] as unknown[];

  // Check for existing gitdash entry
  const existingIdx = sessionStart.findIndex(isGitdashEntry);

  if (existingIdx !== -1) {
    // Check if it's already the canonical form
    const existingEntry = sessionStart[existingIdx];
    const existingJson = JSON.stringify(existingEntry);
    const canonicalJson = JSON.stringify(CANONICAL_HOOK);

    if (existingJson === canonicalJson) {
      process.stdout.write(
        `gitdash hook already installed at ${targetPath}\n`,
      );
      return; // idempotent — no write, no backup
    }

    // Stale entry — replace
    if (dryRun) {
      sessionStart[existingIdx] = CANONICAL_HOOK;
      process.stdout.write(
        `[dry-run] would update stale gitdash entry in ${targetPath}:\n` +
          JSON.stringify(settings, null, 2) + "\n",
      );
      return;
    }

    await backup();
    sessionStart[existingIdx] = CANONICAL_HOOK;
    await writeSettings(settings);
    process.stdout.write(`gitdash hook updated at ${targetPath}\n`);
    return;
  }

  // No existing entry — append
  if (dryRun) {
    sessionStart.push(CANONICAL_HOOK);
    process.stdout.write(
      `[dry-run] would write to ${targetPath}:\n` +
        JSON.stringify(settings, null, 2) + "\n",
    );
    return;
  }

  await backup(); // no-op if file doesn't exist yet
  sessionStart.push(CANONICAL_HOOK);
  await writeSettings(settings);
  process.stdout.write(`gitdash hook installed at ${targetPath}\n`);
}

async function runUninstall(existing: SettingsJson | null): Promise<void> {
  if (!existing) {
    process.stdout.write("no gitdash hook found (file does not exist)\n");
    return;
  }

  const hooks = existing["hooks"];
  if (!hooks || typeof hooks !== "object") {
    process.stdout.write("no gitdash hook found\n");
    return;
  }
  const hooksObj = hooks as Record<string, unknown>;
  if (!Array.isArray(hooksObj["SessionStart"])) {
    process.stdout.write("no gitdash hook found\n");
    return;
  }

  const sessionStart = hooksObj["SessionStart"] as unknown[];
  const idx = sessionStart.findIndex(isGitdashEntry);

  if (idx === -1) {
    process.stdout.write("no gitdash hook found\n");
    return;
  }

  if (dryRun) {
    sessionStart.splice(idx, 1);
    process.stdout.write(
      `[dry-run] would write to ${targetPath}:\n` +
        JSON.stringify(existing, null, 2) + "\n",
    );
    return;
  }

  sessionStart.splice(idx, 1);
  // Leave hooks.SessionStart as [] even if empty — user may re-install later
  await writeSettings(existing);
  process.stdout.write(`gitdash hook removed from ${targetPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`[gitdash] unexpected error: ${String(err)}\n`);
  process.exit(1);
});
