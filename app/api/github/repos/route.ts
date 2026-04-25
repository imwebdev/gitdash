import { NextResponse } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import {
  fetchUserGithubRepos,
  filterCloneable,
  getKnownGithubSlugs,
} from "@/lib/gh/list";
import { resolveCloneDir } from "@/lib/gh/clone";
import { readFile } from "node:fs/promises";
import path from "node:path";

interface CloneConfig {
  cloneDir?: string;
}

/**
 * Read cloneDir override from ~/.config/gitdash/config.json. Same file
 * DiscoveryConfig comes from. If missing or unparseable, return undefined
 * and let resolveCloneDir fall back to its default.
 */
async function readCloneConfig(): Promise<CloneConfig> {
  const xdg =
    process.env.XDG_CONFIG_HOME ??
    path.join(process.env.HOME ?? ".", ".config");
  const configPath = path.join(xdg, "gitdash", "config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw) as CloneConfig;
  } catch {
    return {};
  }
}

export async function GET() {
  await bootstrap();

  let remote;
  try {
    remote = await fetchUserGithubRepos();
  } catch (err) {
    const e = err as Error & { stderr?: string };
    return NextResponse.json(
      {
        error: "gh repo list failed",
        detail: (e.stderr ?? e.message ?? String(err)).slice(0, 1000),
        hint: "Run `gh auth status` on the box. If unauthenticated, run `gh auth login`.",
      },
      { status: 502 },
    );
  }

  const known = getKnownGithubSlugs();
  const cloneable = filterCloneable(remote, known);

  const config = await readCloneConfig();
  const cloneDir = resolveCloneDir(config.cloneDir);

  return NextResponse.json({
    repos: cloneable,
    cloneDir,
    counts: {
      total: remote.length,
      cloneable: cloneable.length,
      alreadyLocal: remote.length - cloneable.length,
    },
  });
}
