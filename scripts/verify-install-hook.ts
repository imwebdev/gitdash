/**
 * scripts/verify-install-hook.ts
 *
 * Focused verification for install-hook.ts behaviour.
 * Run with: npx tsx scripts/verify-install-hook.ts
 *
 * Cases covered:
 *   1. Fresh install — writes empty-string matcher
 *   2. Idempotent install — no write when already canonical
 *   3. Migration — rewrites deprecated "matcher": "*" → "" with expected message
 *   4. Uninstall — removes entry cleanly
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

// ── helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    process.stdout.write(`  ✓ ${label}\n`);
    passed++;
  } else {
    process.stdout.write(`  ✗ ${label}${detail ? ` — ${detail}` : ""}\n`);
    failed++;
  }
}

function tempDir(): string {
  return mkdirSync(path.join(os.tmpdir(), `gitdash-test-${Date.now()}`), { recursive: true }) as unknown as string
    ?? path.join(os.tmpdir(), `gitdash-test-${Date.now()}`);
}

function runHook(settingsPath: string, extra: string[] = []): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(
      "npx", ["tsx", path.join(process.cwd(), "scripts/install-hook.ts"), ...extra],
      {
        env: { ...process.env, GITDASH_INSTALL_HOOK_TARGET: settingsPath },
        encoding: "utf8",
      },
    );
    return { stdout, status: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

function readSettings(p: string): Record<string, unknown> {
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
}

function getMatcher(settings: Record<string, unknown>): string | undefined {
  const hooks = settings["hooks"] as Record<string, unknown> | undefined;
  const ss = hooks?.["SessionStart"] as unknown[] | undefined;
  const entry = ss?.[0] as Record<string, unknown> | undefined;
  return entry?.["matcher"] as string | undefined;
}

function countEntries(settings: Record<string, unknown>): number {
  const hooks = settings["hooks"] as Record<string, unknown> | undefined;
  const ss = hooks?.["SessionStart"] as unknown[] | undefined;
  return ss?.length ?? 0;
}

// ── Case 1: Fresh install ─────────────────────────────────────────────────────

process.stdout.write("\nCase 1: Fresh install\n");
{
  const dir = os.tmpdir() + `/gitdash-test-fresh-${Date.now()}`;
  mkdirSync(dir, { recursive: true });
  const settingsPath = path.join(dir, "settings.json");

  const { stdout, status } = runHook(settingsPath);
  assert("exits 0", status === 0, `status=${status}`);
  assert("file created", existsSync(settingsPath));

  const s = readSettings(settingsPath);
  assert('matcher is ""', getMatcher(s) === "", `got: ${getMatcher(s)}`);
  assert("stdout mentions installed", stdout.includes("installed"));

  rmSync(dir, { recursive: true, force: true });
}

// ── Case 2: Idempotent install ────────────────────────────────────────────────

process.stdout.write("\nCase 2: Idempotent install (already canonical)\n");
{
  const dir = os.tmpdir() + `/gitdash-test-idempotent-${Date.now()}`;
  mkdirSync(dir, { recursive: true });
  const settingsPath = path.join(dir, "settings.json");

  // First install
  runHook(settingsPath);
  const mtime1 = readFileSync(settingsPath).toString();

  // Second install
  const { stdout, status } = runHook(settingsPath);
  const mtime2 = readFileSync(settingsPath).toString();

  assert("exits 0", status === 0);
  assert("file unchanged (idempotent)", mtime1 === mtime2);
  assert("stdout says already installed", stdout.includes("already installed"));

  const s = readSettings(settingsPath);
  assert("still one entry", countEntries(s) === 1);

  rmSync(dir, { recursive: true, force: true });
}

// ── Case 3: Migration from deprecated matcher "*" ─────────────────────────────

process.stdout.write('\nCase 3: Migration — existing entry with matcher "*"\n');
{
  const dir = os.tmpdir() + `/gitdash-test-migrate-${Date.now()}`;
  mkdirSync(dir, { recursive: true });
  const settingsPath = path.join(dir, "settings.json");

  // Pre-write a settings file with the buggy matcher
  const buggySettings = {
    hooks: {
      SessionStart: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: "gitdash status --cwd $CLAUDE_PROJECT_DIR",
            },
          ],
        },
      ],
    },
  };
  writeFileSync(settingsPath, JSON.stringify(buggySettings, null, 2) + "\n", "utf8");

  const { stdout, status } = runHook(settingsPath);
  assert("exits 0", status === 0, `status=${status}`);

  const s = readSettings(settingsPath);
  assert('matcher is now ""', getMatcher(s) === "", `got: ${getMatcher(s)}`);
  assert("only one gitdash entry", countEntries(s) === 1, `got: ${countEntries(s)}`);
  assert(
    "migration message printed",
    stdout.includes("updated matcher on existing gitdash hook (was using deprecated value)"),
    `stdout: ${stdout.trim()}`,
  );

  rmSync(dir, { recursive: true, force: true });
}

// ── Case 4: Uninstall ─────────────────────────────────────────────────────────

process.stdout.write("\nCase 4: Uninstall\n");
{
  const dir = os.tmpdir() + `/gitdash-test-uninstall-${Date.now()}`;
  mkdirSync(dir, { recursive: true });
  const settingsPath = path.join(dir, "settings.json");

  runHook(settingsPath);
  const { stdout, status } = runHook(settingsPath, ["--uninstall"]);

  assert("exits 0", status === 0);
  assert("stdout mentions removed", stdout.includes("removed"));

  const s = readSettings(settingsPath);
  assert("zero entries after uninstall", countEntries(s) === 0, `got: ${countEntries(s)}`);

  rmSync(dir, { recursive: true, force: true });
}

// ── Summary ───────────────────────────────────────────────────────────────────

process.stdout.write(`\n${passed + failed} checks — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
