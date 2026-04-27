import { opendir, stat, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export interface DiscoveryConfig {
  roots: string[];
  maxDepth: number;
  excludePatterns: string[];
  /** If false, paths starting with "." are excluded (except allowed roots). */
  includeDotfilesAsRepoRoots: boolean;
  /** If false, the home-dir-as-repo and dotfile-tool repos are filtered out. */
  showSystemRepos: boolean;
}

export const DEFAULT_CONFIG: DiscoveryConfig = {
  roots: [process.env.HOME ?? "/home"],
  maxDepth: 6,
  excludePatterns: [
    "node_modules",
    ".cache",
    ".nvm",
    ".mcp",
    ".codex",
    ".nemoclaw",
    ".openclaw",
    "snap",
    ".npm",
    ".pnpm-store",
    ".yarn",
    ".pyenv",
    ".rustup",
    ".cargo",
    ".rbenv",
    ".docker",
    ".vscode-server",
    ".claude",
    ".local",
    ".config",
    "Library",
  ],
  includeDotfilesAsRepoRoots: false,
  showSystemRepos: false,
};

export interface DiscoveredRepo {
  repoPath: string;
  gitDirPath: string;
  isSystemRepo: boolean;
  weirdFlags: string[];
}

const SYSTEM_REPO_HINTS = [
  /^\/home\/[^/]+\/\.git$/, // home-as-repo
  /\/\.(nvm|mcp|codex|nemoclaw|openclaw|config|local|cache|claude|npm|pnpm-store|yarn|pyenv|rustup|cargo|rbenv|docker|vscode-server)\b/,
];

// Captured once at module load. The launcher (`bin/gitdash`) cd's into the
// project root before exec'ing next, so `process.cwd()` is the gitdash repo
// path for any process serving the dashboard. Tests / scripts that import
// this module from a different cwd will get a different self-path, which is
// fine — the only effect is that those contexts won't apply the self-exempt.
const SELF_REPO_PATH = path.resolve(process.cwd());

export function isSystemRepoPath(repoPath: string): boolean {
  // Never hide gitdash from its own dashboard. The default install location
  // ~/.local/share/gitdash matches the /\.local\b/ system-repo hint, which
  // would otherwise hide the user's primary tool until they discover the
  // 'show system repos' toggle.
  if (path.resolve(repoPath) === SELF_REPO_PATH) return false;
  return SYSTEM_REPO_HINTS.some((re) => re.test(repoPath));
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function detectWeirdFlags(repoPath: string): Promise<string[]> {
  const gitDir = path.join(repoPath, ".git");
  const flags: string[] = [];

  // Handle worktree case where .git is a file pointer
  let actualGitDir = gitDir;
  try {
    const s = await stat(gitDir);
    if (s.isFile()) {
      // .git file contains "gitdir: <path>"
      const { readFile } = await import("node:fs/promises");
      const contents = await readFile(gitDir, "utf8");
      const match = contents.match(/^gitdir:\s*(.+)$/m);
      if (match && match[1]) {
        actualGitDir = path.isAbsolute(match[1]) ? match[1] : path.resolve(repoPath, match[1]);
      }
    }
  } catch {
    return flags;
  }

  if (await fileExists(path.join(actualGitDir, "MERGE_HEAD"))) flags.push("merge-in-progress");
  if (await dirExists(path.join(actualGitDir, "rebase-merge"))) flags.push("rebase-in-progress");
  if (await dirExists(path.join(actualGitDir, "rebase-apply"))) flags.push("rebase-apply-in-progress");
  if (await fileExists(path.join(actualGitDir, "CHERRY_PICK_HEAD"))) flags.push("cherry-pick-in-progress");
  if (await fileExists(path.join(actualGitDir, "REVERT_HEAD"))) flags.push("revert-in-progress");
  if (await fileExists(path.join(actualGitDir, "BISECT_LOG"))) flags.push("bisect-in-progress");

  return flags;
}

export async function discoverRepos(config: DiscoveryConfig): Promise<DiscoveredRepo[]> {
  const excludes = new Set(config.excludePatterns);
  const seen = new Set<string>();
  const results: DiscoveredRepo[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > config.maxDepth) return;
    if (seen.has(dir)) return;
    seen.add(dir);

    let entries: AsyncIterableIterator<import("node:fs").Dirent> | undefined;
    try {
      entries = (await opendir(dir))[Symbol.asyncIterator]();
    } catch {
      return;
    }

    // Check the current directory for a .git child before descending into sub-entries.
    // (We descend regardless, because nested repos in subdirectories are allowed.)
    const gitChild = path.join(dir, ".git");
    const gitExists = await fileExists(gitChild);
    if (gitExists) {
      const isSystem = isSystemRepoPath(gitChild);
      if (config.showSystemRepos || !isSystem) {
        const weirdFlags = await detectWeirdFlags(dir);
        results.push({
          repoPath: dir,
          gitDirPath: gitChild,
          isSystemRepo: isSystem,
          weirdFlags,
        });
      }
    }

    for await (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name === ".git") continue;
      if (excludes.has(name)) continue;
      if (!config.includeDotfilesAsRepoRoots && name.startsWith(".")) {
        continue;
      }
      const next = path.join(dir, name);
      await walk(next, depth + 1);
    }
  }

  for (const root of config.roots) {
    await walk(root, 0);
  }

  return results;
}

const GITHUB_REMOTE_RE =
  /^(?:https?:\/\/(?:[^@]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

export interface GitHubSlug {
  owner: string;
  name: string;
}

export function parseGithubSlug(remoteUrl: string | null): GitHubSlug | null {
  if (!remoteUrl) return null;
  const m = remoteUrl.trim().match(GITHUB_REMOTE_RE);
  if (!m || !m[1] || !m[2]) return null;
  return { owner: m[1], name: m[2] };
}
