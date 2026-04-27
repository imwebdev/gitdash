import { NextResponse, type NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bootstrap } from "@/lib/bootstrap";
import { validateCsrf } from "@/lib/security/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

const SSH_DIR = path.join(os.homedir(), ".ssh");

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readPubKey(pubPath: string): Promise<string | null> {
  try {
    const content = await readFile(pubPath, "utf8");
    const firstLine = content.split("\n")[0]?.trim();
    return firstLine || null;
  } catch {
    return null;
  }
}

/** Returns { keyPath, pubKey } for the key to use (existing or newly generated). */
async function resolveOrGenerateKey(): Promise<{ keyPath: string; pubKey: string; generated: boolean }> {
  // Safety: all key paths must be inside ~/.ssh
  const candidates = [
    path.join(SSH_DIR, "gitdash_signing"),
    path.join(SSH_DIR, "id_ed25519"),
    path.join(SSH_DIR, "id_rsa"),
  ];

  for (const keyPath of candidates) {
    const pubPath = `${keyPath}.pub`;
    if (await fileExists(pubPath)) {
      const pubKey = await readPubKey(pubPath);
      if (pubKey) {
        return { keyPath, pubKey, generated: false };
      }
    }
  }

  // Generate a new ed25519 key
  const newKeyPath = path.join(SSH_DIR, "gitdash_signing");

  // Ensure ~/.ssh exists with correct permissions
  await mkdir(SSH_DIR, { recursive: true, mode: 0o700 });

  const hostname = os.hostname();
  const comment = `gitdash-signing-${hostname}`;

  await execFileAsync("ssh-keygen", [
    "-t", "ed25519",
    "-f", newKeyPath,
    "-N", "",
    "-C", comment,
  ], { timeout: 15_000 });

  const pubKey = await readPubKey(`${newKeyPath}.pub`);
  if (!pubKey) {
    throw new Error("ssh-keygen ran but the .pub file could not be read");
  }

  return { keyPath: newKeyPath, pubKey, generated: true };
}

/** Set git global config. Uses execFile directly since these are --global config writes. */
async function setGitConfig(key: string, value: string): Promise<void> {
  await execFileAsync("git", ["config", "--global", key, value], {
    timeout: 10_000,
  });
}

/** Check if this pubKey is already registered on GitHub. */
async function isPubKeyRegistered(pubKey: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("gh", ["api", "user/ssh_signing_keys", "--jq", ".[].key"], {
      timeout: 15_000,
    });
    const remoteKeys = stdout.split("\n").map((k) => k.trim()).filter(Boolean);
    const localParts = pubKey.split(/\s+/).slice(0, 2).join(" ");
    return remoteKeys.some((rk) => {
      const remoteParts = rk.split(/\s+/).slice(0, 2).join(" ");
      return remoteParts === localParts;
    });
  } catch {
    return false;
  }
}

/** Register pubKey on GitHub via `gh api`. Returns true if newly registered, false if already registered. */
async function registerKeyOnGithub(pubKey: string): Promise<boolean> {
  const hostname = os.hostname();
  const title = `gitdash signing key (${hostname})`;

  try {
    await execFileAsync(
      "gh",
      [
        "api",
        "-X", "POST",
        "user/ssh_signing_keys",
        "-f", `title=${title}`,
        "-f", `key=${pubKey}`,
      ],
      { timeout: 20_000 },
    );
    return true;
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string };
    const errText = `${e.stderr ?? ""} ${e.stdout ?? ""}`.toLowerCase();

    // 422 "key is already in use" — idempotent success
    if (errText.includes("key is already in use") || errText.includes("already in use")) {
      return false;
    }

    // Scope missing — surface a clear error.
    // Triggers: gh's own hint ("needs the X scope"), 404 with ssh_signing_key
    // mentioned (GitHub returns 404, not 403, when the token lacks the scope),
    // or any of the read/write/admin variants.
    const mentionsSshSigningScope = /ssh_signing_key/i.test(errText);
    const mentionsScope = /needs the .* scope|missing required scope|requires .* scope/i.test(errText);
    const is404 = /\b404\b|not found/i.test(errText);
    if ((mentionsScope && mentionsSshSigningScope) || (is404 && mentionsSshSigningScope)) {
      throw new Error(
        "GitHub needs an extra permission before gitdash can register a signing key. " +
        "Close this dialog, click \"Connect GitHub\" in the banner, and complete the GitHub sign-in. " +
        "After that, click \"Set up signing\" again and it will work.",
      );
    }

    // Auth error
    if (errText.includes("401") || errText.includes("not authenticated") || errText.includes("not logged")) {
      throw new Error(
        "GitHub CLI isn't authenticated. Please connect GitHub first using the banner above.",
      );
    }

    throw new Error(
      `Failed to register key on GitHub: ${(e.stderr ?? e.stdout ?? String(err)).trim().slice(0, 400)}`,
    );
  }
}

export async function POST(req: NextRequest) {
  await bootstrap();

  if (!validateCsrf(req.headers.get("x-csrf-token"))) {
    return NextResponse.json({ error: "csrf" }, { status: 403 });
  }

  try {
    const { keyPath, pubKey, generated } = await resolveOrGenerateKey();
    const pubKeyPath = `${keyPath}.pub`;

    // Check if already registered before trying to register
    const alreadyRegistered = !generated && await isPubKeyRegistered(pubKey);

    if (!alreadyRegistered) {
      await registerKeyOnGithub(pubKey);
    }

    // Set git global config (idempotent)
    await Promise.all([
      setGitConfig("gpg.format", "ssh"),
      setGitConfig("commit.gpgsign", "true"),
      setGitConfig("user.signingkey", pubKeyPath),
    ]);

    return NextResponse.json({
      ok: true,
      keyPath: pubKeyPath,
      alreadyRegistered,
      generated,
    });
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    return NextResponse.json(
      { ok: false, error: message.slice(0, 600) },
      { status: 500 },
    );
  }
}
