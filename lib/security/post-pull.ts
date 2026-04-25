import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PullFinding {
  path: string;
  reason: string;
}

async function gitShow(repoPath: string, ref: string, filePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repoPath, "show", `${ref}:${filePath}`],
      { timeout: 10_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );
    return stdout;
  } catch {
    return null;
  }
}

async function packageJsonScriptsChanged(
  repoPath: string,
  oldHead: string,
  newHead: string,
  filePath: string,
): Promise<boolean> {
  const [oldContent, newContent] = await Promise.all([
    gitShow(repoPath, oldHead, filePath),
    gitShow(repoPath, newHead, filePath),
  ]);
  if (!newContent) return false;
  if (!oldContent) return true;

  let oldScripts: Record<string, unknown> = {};
  let newScripts: Record<string, unknown> = {};
  try {
    const oldPkg = JSON.parse(oldContent) as Record<string, unknown>;
    oldScripts = (typeof oldPkg.scripts === "object" && oldPkg.scripts !== null)
      ? (oldPkg.scripts as Record<string, unknown>)
      : {};
  } catch {
    return true;
  }
  try {
    const newPkg = JSON.parse(newContent) as Record<string, unknown>;
    newScripts = (typeof newPkg.scripts === "object" && newPkg.scripts !== null)
      ? (newPkg.scripts as Record<string, unknown>)
      : {};
  } catch {
    return true;
  }

  const allKeys = new Set([...Object.keys(oldScripts), ...Object.keys(newScripts)]);
  for (const key of allKeys) {
    if (oldScripts[key] !== newScripts[key]) return true;
  }
  return false;
}

function classifyPath(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  const parts = filePath.split("/");
  const topLevel = parts[0] ?? "";
  const topLevelLower = topLevel.toLowerCase();

  if (topLevelLower === "package.json") return "__package_json__";

  if (parts[0] === ".github") {
    if (parts[1] === "workflows") {
      return "A CI/CD workflow changed — it controls what happens automatically every time code is pushed. Review before pushing to make sure you understand what will run.";
    }
    return "A GitHub configuration file changed — these files control automation, issue templates, and security settings for the project.";
  }

  if (parts[0] === ".husky") {
    return "A Git hook changed — these scripts run automatically on your computer when you commit or push. Review before committing to make sure you're OK with what will run.";
  }

  if (parts[0] === "scripts") {
    return "A project script changed — these are programs that can run on your computer. Review before running any setup or build commands.";
  }

  if (parts[0] === ".devcontainer") {
    return "A dev container configuration changed — this controls the environment that gets built when you open the project in a container. Review before opening.";
  }

  if (/^dockerfile(\..*)?$/i.test(topLevel)) {
    return "The Dockerfile changed — this controls what gets built into containers for this project. Review before building.";
  }

  if (
    topLevelLower === "docker-compose.yml" ||
    topLevelLower === "docker-compose.yaml" ||
    topLevelLower === "compose.yml" ||
    topLevelLower === "compose.yaml"
  ) {
    return "The Docker Compose file changed — this defines the services that run when you start the project. Review before running.";
  }

  if (
    topLevelLower === ".gitlab-ci.yml" ||
    topLevelLower === "bitbucket-pipelines.yml" ||
    topLevelLower === "azure-pipelines.yml"
  ) {
    return "A CI/CD pipeline file changed — it controls what runs automatically on every push. Review before pushing.";
  }

  if (parts[0] === ".circleci" && parts[1] === "config.yml") {
    return "The CircleCI config changed — it controls what runs automatically on every push. Review before pushing.";
  }

  if (
    topLevelLower === "install.sh" ||
    topLevelLower === "setup.sh" ||
    topLevelLower === "bootstrap.sh" ||
    topLevelLower === "makefile"
  ) {
    return "An install or setup script changed — don't run it until you've reviewed what it does. It can make changes to your computer.";
  }

  return null;
}

export async function classifyPulledChanges(
  repoPath: string,
  oldHead: string,
  newHead: string,
): Promise<PullFinding[]> {
  let changedFiles: string[] = [];
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repoPath, "diff", `${oldHead}..${newHead}`, "--name-only"],
      { timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );
    changedFiles = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }

  if (changedFiles.length === 0) return [];

  const findings: PullFinding[] = [];
  const seen = new Set<string>();

  for (const filePath of changedFiles) {
    const label = classifyPath(filePath);
    if (!label) continue;

    if (label === "__package_json__") {
      const changed = await packageJsonScriptsChanged(repoPath, oldHead, newHead, filePath);
      if (!changed) continue;
      const key = "package.json:scripts";
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        path: filePath,
        reason:
          "The npm scripts in package.json changed — running 'npm install' or 'npm run' could now execute different code on your computer. Check what changed before installing.",
      });
      continue;
    }

    if (seen.has(filePath)) continue;
    seen.add(filePath);
    findings.push({ path: filePath, reason: label });
  }

  return findings;
}
