import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { assertSafeRef } from "./exec";
import { translateGitError, friendlyStepLabel } from "./error-hints";
import { getDb } from "@/lib/db/schema";

const execFileAsync = promisify(execFile);

export type ActionName =
  | "fetch"
  | "pull"
  | "push"
  | "merge"
  | "stash-push"
  | "stash-pop"
  | "open-editor"
  | "open-terminal"
  | "commit"
  | "commit-push"
  | "publish-to-github"
  | "create-pr";

export interface PublishOptions {
  name: string;
  visibility: "private" | "public";
  description?: string;
}

const PUBLISH_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function isValidPublishName(name: string): boolean {
  return PUBLISH_NAME_RE.test(name);
}

export interface ActionRun {
  id: string;
  repoId: number;
  action: ActionName;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  emitter: EventEmitter;
  lines: string[];
  aborted: boolean;
  child: ReturnType<typeof spawn> | null;
}

const runs = new Map<string, ActionRun>();

export function getRun(id: string): ActionRun | null {
  return runs.get(id) ?? null;
}

interface StartOptions {
  repoId: number;
  repoPath: string;
  action: ActionName;
  branch: string | null;
  commitMessage?: string;
  publish?: PublishOptions;
}

export function startAction(opts: StartOptions): ActionRun {
  const runId = randomUUID();
  const emitter = new EventEmitter();
  const run: ActionRun = {
    id: runId,
    repoId: opts.repoId,
    action: opts.action,
    startedAt: Date.now(),
    finishedAt: null,
    exitCode: null,
    emitter,
    lines: [],
    aborted: false,
    child: null,
  };
  runs.set(runId, run);

  if (opts.action === "commit-push" || opts.action === "commit") {
    const message = sanitizeCommitMessage(opts.commitMessage);
    const pushAfter = opts.action === "commit-push";
    setImmediate(() => {
      executeCommit(run, opts.repoPath, message, opts.branch, pushAfter).catch((err) => {
        run.emitter.emit("done", { exitCode: -1 });
        run.exitCode = -1;
        run.finishedAt = Date.now();
        recordRunFinish(run);
        run.lines.push(`[fatal] ${(err as Error).message}`);
      });
    });
    getDb().prepare(
      "INSERT INTO actions_log (repo_id, action, started_at) VALUES (?, ?, ?)",
    ).run(opts.repoId, opts.action, run.startedAt);
    return run;
  }

  if (opts.action === "publish-to-github") {
    if (!opts.publish) {
      throw new Error("publish-to-github requires publish options");
    }
    if (!isValidPublishName(opts.publish.name)) {
      throw new Error("invalid repository name");
    }
    const publish = opts.publish;
    setImmediate(() => {
      executePublishToGithub(run, opts.repoPath, publish).catch((err) => {
        run.emitter.emit("done", { exitCode: -1 });
        run.exitCode = -1;
        run.finishedAt = Date.now();
        recordRunFinish(run);
        run.lines.push(`[fatal] ${(err as Error).message}`);
      });
    });
    getDb().prepare(
      "INSERT INTO actions_log (repo_id, action, started_at) VALUES (?, ?, ?)",
    ).run(opts.repoId, opts.action, run.startedAt);
    return run;
  }

  if (opts.action === "create-pr") {
    setImmediate(() => {
      executeCreatePr(run, opts.repoPath, opts.branch).catch((err) => {
        run.emitter.emit("done", { exitCode: -1 });
        run.exitCode = -1;
        run.finishedAt = Date.now();
        recordRunFinish(run);
        run.lines.push(`[fatal] ${(err as Error).message}`);
      });
    });
    getDb().prepare(
      "INSERT INTO actions_log (repo_id, action, started_at) VALUES (?, ?, ?)",
    ).run(opts.repoId, opts.action, run.startedAt);
    return run;
  }

  // push gets special treatment: fetch-rebase first, then the actual push.
  if (opts.action === "push") {
    setImmediate(() => {
      executePush(run, opts.repoPath, opts.branch).catch((err) => {
        run.emitter.emit("done", { exitCode: -1 });
        run.exitCode = -1;
        run.finishedAt = Date.now();
        recordRunFinish(run);
        run.lines.push(`[fatal] ${(err as Error).message}`);
      });
    });
    getDb().prepare(
      "INSERT INTO actions_log (repo_id, action, started_at) VALUES (?, ?, ?)",
    ).run(opts.repoId, opts.action, run.startedAt);
    return run;
  }

  const args = buildArgs(opts.action, opts.branch);
  let executable: string;
  let spawnArgs: string[];
  if (opts.action === "open-editor") {
    executable = getEditor();
    spawnArgs = [opts.repoPath];
  } else if (opts.action === "open-terminal") {
    executable = getTerminal();
    spawnArgs = [];
  } else {
    executable = "git";
    spawnArgs = ["-C", opts.repoPath, ...args];
  }

  const cwd = opts.action === "open-terminal" ? opts.repoPath : undefined;
  setImmediate(() => executeRun(run, executable, spawnArgs, cwd));

  getDb().prepare(
    "INSERT INTO actions_log (repo_id, action, started_at) VALUES (?, ?, ?)",
  ).run(opts.repoId, opts.action, run.startedAt);

  return run;
}

function buildArgs(action: ActionName, branch: string | null): string[] {
  switch (action) {
    case "fetch":
      return ["fetch", "--prune"];
    case "pull":
      return ["pull", "--ff-only"];
    case "push":
      return ["push"];
    case "merge":
      if (!branch) throw new Error("merge requires a branch");
      assertSafeRef(branch);
      return ["merge", "--no-ff", `origin/${branch}`];
    case "stash-push":
      return ["stash", "push", "-u", "-m", `gitdash-${new Date().toISOString()}`];
    case "stash-pop":
      return ["stash", "pop"];
    case "open-editor":
      return [];
    case "open-terminal":
      return [];
    case "commit":
      return [];
    case "commit-push":
      return [];
    case "publish-to-github":
      return [];
    case "create-pr":
      return [];
  }
}

function sanitizeCommitMessage(input: string | undefined): string {
  const raw = (input ?? "").trim();
  if (!raw) return `Update from ${process.env.HOSTNAME ?? "gitdash"}`;
  // Collapse bare CRs to LFs; cap length to keep the buffer safe.
  return raw.replace(/\r\n?/g, "\n").slice(0, 5000);
}

function emitHint(emit: (text: string) => void, lines: readonly string[]): void {
  const result = translateGitError(lines);
  if (!result) return;
  for (const line of result.hint.split("\n")) {
    emit(`[gitdash] hint: ${line}`);
  }
}

function friendlyActionLabel(action: ActionName): string {
  switch (action) {
    case "fetch":
      return "Fetch";
    case "pull":
      return "Pull";
    case "push":
      return "Push";
    case "merge":
      return "Merge";
    case "stash-push":
      return "Stash";
    case "stash-pop":
      return "Stash pop";
    case "open-editor":
      return "Open editor";
    case "open-terminal":
      return "Open terminal";
    case "commit":
      return "Commit";
    case "commit-push":
      return "Commit & push";
    case "publish-to-github":
      return "Publish to GitHub";
    case "create-pr":
      return "Create Pull Request";
  }
}

function recordRunFinish(run: ActionRun): void {
  const truncated = run.lines.slice(-200).join("\n");
  try {
    getDb().prepare(
      "UPDATE actions_log SET finished_at = ?, exit_code = ?, truncated_output = ? WHERE repo_id = ? AND started_at = ?",
    ).run(run.finishedAt ?? Date.now(), run.exitCode ?? -1, truncated, run.repoId, run.startedAt);
  } catch {
    // best-effort
  }
}

/**
 * Runs a single git command via spawn (not execFile) so output streams live to
 * the ActionRun's line emitter.  Returns the exit code.
 */
function spawnGitStep(
  run: ActionRun,
  emit: (text: string) => void,
  args: string[],
  repoPath: string,
): Promise<number> {
  return new Promise<number>((resolve) => {
    emit(`$ git ${args.join(" ")}`);
    const child = spawn("git", ["-C", repoPath, ...args], {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "/bin/echo",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    run.child = child;
    const onData = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.length > 0) emit(line);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setTimeout(() => {
      emit("[timeout] SIGTERM");
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3_000);
    }, 120_000);
    child.on("close", (c) => {
      clearTimeout(timer);
      resolve(c ?? -1);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      emit(`[error] ${err.message}`);
      resolve(-1);
    });
  });
}

/**
 * Returns the args for `git push` for this branch. If the branch has no
 * upstream configured, returns ["push", "-u", "origin", "HEAD"] so the
 * branch publishes itself instead of failing with "no upstream branch."
 * Otherwise plain ["push"]. Detached HEAD also gets plain push.
 */
async function buildPushArgs(repoPath: string, branch: string | null): Promise<string[]> {
  if (!branch || branch === "(detached)") return ["push"];
  try {
    await execFileAsync(
      "git",
      ["-C", repoPath, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { timeout: 5_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );
    return ["push"];
  } catch {
    // No upstream — publish the branch to origin. The user already clicked
    // Push so consent for "this leaves my machine" is established; the
    // -u flag wires up tracking so subsequent pushes are plain pushes.
    return ["push", "-u", "origin", "HEAD"];
  }
}

/**
 * Reads the tracked remote name for the given branch from git config.
 * Priority: branch.<branch>.pushRemote → branch.<branch>.remote → "origin"
 * Returns null when the branch or remote cannot be determined (detached HEAD etc.).
 */
async function getTrackedRemote(repoPath: string, branch: string | null): Promise<string | null> {
  if (!branch || branch === "(detached)") return null;

  const tryConfig = async (key: string): Promise<string | null> => {
    try {
      const result = await execFileAsync("git", ["-C", repoPath, "config", "--get", key], {
        timeout: 5_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  };

  const pushRemote = await tryConfig(`branch.${branch}.pushRemote`);
  if (pushRemote) return pushRemote;
  const remote = await tryConfig(`branch.${branch}.remote`);
  if (remote) return remote;

  // Check if "origin" even exists before defaulting to it.
  try {
    await execFileAsync("git", ["-C", repoPath, "config", "--get", "remote.origin.url"], {
      timeout: 5_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return "origin";
  } catch {
    return null;
  }
}

/**
 * Fetch-rebase step: fetches the tracked remote, counts how many commits the
 * remote is ahead of HEAD, and (if any) rebases local work on top.
 *
 * Returns:
 *   - true  → step succeeded; caller may proceed to push
 *   - false → step failed (conflict / unexpected error); action must stop
 */
async function executeFetchRebase(
  run: ActionRun,
  emit: (text: string) => void,
  repoPath: string,
  branch: string | null,
): Promise<boolean> {
  emit(`$ [gitdash] fetch-rebase step starting`);

  // --- resolve branch name ---
  if (!branch || branch === "(detached)") {
    emit("[gitdash] Detached HEAD — skipping fetch-rebase, proceeding directly to push.");
    return true;
  }

  // --- resolve remote ---
  const remote = await getTrackedRemote(repoPath, branch);
  if (!remote) {
    emit("[gitdash] No upstream configured — pushing directly.");
    return true;
  }

  // --- fetch (failure is non-fatal) ---
  const fetchCode = await spawnGitStep(run, emit, ["fetch", remote], repoPath);
  if (fetchCode !== 0) {
    emit(`[gitdash] fetch failed (exit ${fetchCode}) — will try push anyway.`);
    // non-fatal: continue to push
    return true;
  }

  // --- count how far remote is ahead ---
  let remoteAhead = 0;
  try {
    const result = await execFileAsync(
      "git",
      ["-C", repoPath, "rev-list", "--count", `HEAD..${remote}/${branch}`],
      { timeout: 10_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );
    remoteAhead = parseInt(result.stdout.trim(), 10) || 0;
  } catch {
    // If rev-list fails (e.g. no remote tracking branch yet) skip rebase.
    emit("[gitdash] Could not determine remote position — skipping rebase.");
    return true;
  }

  if (remoteAhead === 0) {
    emit("[gitdash] remote unchanged, pushing directly.");
    return true;
  }

  // --- rebase ---
  emit(`[gitdash] Remote moved by ${remoteAhead} commit(s) — rebasing local work on top.`);
  const rebaseCode = await spawnGitStep(run, emit, ["rebase", `${remote}/${branch}`], repoPath);

  if (rebaseCode === 0) {
    return true;
  }

  // --- rebase failed: clean up and propagate failure ---
  emit(`[gitdash] ✗ ${friendlyStepLabel("fetch-rebase")} didn't complete (exit ${rebaseCode}).`);
  // Always abort to leave repo in clean state.
  await spawnGitStep(run, emit, ["rebase", "--abort"], repoPath);
  emit("[gitdash] ✗ Rebase had conflicts — repo restored to pre-pull state.");
  emitHint(emit, run.lines);
  return false;
}

/** Standalone push action: fetch-rebase → push. */
async function executePush(run: ActionRun, repoPath: string, branch: string | null): Promise<void> {
  const emit = (text: string) => {
    run.lines.push(text);
    run.emitter.emit("line", text);
  };

  const ok = await executeFetchRebase(run, emit, repoPath, branch);
  if (!ok) {
    run.finishedAt = Date.now();
    run.exitCode = 1;
    recordRunFinish(run);
    run.emitter.emit("done", { exitCode: 1 });
    return;
  }

  const pushArgs = await buildPushArgs(repoPath, branch);
  if (pushArgs.length > 1) {
    emit(`[gitdash] Branch '${branch}' isn't on GitHub yet. Publishing it now.`);
  }
  const pushCode = await spawnGitStep(run, emit, pushArgs, repoPath);
  if (pushCode !== 0) {
    emit(`[gitdash] ✗ ${friendlyStepLabel("push")} didn't complete (exit ${pushCode}).`);
    if (isProtectedBranchError(run.lines)) {
      emitProtectedBranchHint(emit);
    } else {
      emitHint(emit, run.lines);
    }
    run.finishedAt = Date.now();
    run.exitCode = pushCode;
    recordRunFinish(run);
    run.emitter.emit("done", { exitCode: pushCode });
    return;
  }

  run.finishedAt = Date.now();
  run.exitCode = 0;
  recordRunFinish(run);
  run.emitter.emit("done", { exitCode: 0 });
}

async function executeCommit(
  run: ActionRun,
  repoPath: string,
  message: string,
  branch: string | null,
  pushAfter: boolean,
): Promise<void> {
  const emit = (text: string) => {
    run.lines.push(text);
    run.emitter.emit("line", text);
  };

  // --- stage ---
  const stageCode = await spawnGitStep(run, emit, ["add", "-A"], repoPath);
  if (stageCode !== 0) {
    emit(`[gitdash] ✗ ${friendlyStepLabel("stage")} didn't complete (exit ${stageCode}).`);
    emitHint(emit, run.lines);
    run.finishedAt = Date.now();
    run.exitCode = stageCode;
    recordRunFinish(run);
    run.emitter.emit("done", { exitCode: stageCode });
    return;
  }

  // --- commit ---
  const commitCode = await spawnGitStep(run, emit, ["commit", "-m", message], repoPath);
  if (commitCode !== 0) {
    if (commitCode === 1) {
      emit(pushAfter
        ? "[gitdash] nothing to commit; skipping push"
        : "[gitdash] nothing to commit");
      run.finishedAt = Date.now();
      run.exitCode = 0;
      recordRunFinish(run);
      run.emitter.emit("done", { exitCode: 0 });
      return;
    }
    emit(`[gitdash] ✗ ${friendlyStepLabel("commit")} didn't complete (exit ${commitCode}).`);
    emitHint(emit, run.lines);
    run.finishedAt = Date.now();
    run.exitCode = commitCode;
    recordRunFinish(run);
    run.emitter.emit("done", { exitCode: commitCode });
    return;
  }

  if (!pushAfter) {
    emit("[gitdash] ✓ Commit created locally. Hit Push when you're ready to upload it to GitHub.");
    run.finishedAt = Date.now();
    run.exitCode = 0;
    recordRunFinish(run);
    run.emitter.emit("done", { exitCode: 0 });
    return;
  }

  // --- fetch-rebase (between commit and push) ---
  const rebaseOk = await executeFetchRebase(run, emit, repoPath, branch);
  if (!rebaseOk) {
    run.finishedAt = Date.now();
    run.exitCode = 1;
    recordRunFinish(run);
    run.emitter.emit("done", { exitCode: 1 });
    return;
  }

  // --- push ---
  const pushArgs = await buildPushArgs(repoPath, branch);
  if (pushArgs.length > 1) {
    emit(`[gitdash] Branch '${branch}' isn't on GitHub yet. Publishing it now.`);
  }
  const pushCode = await spawnGitStep(run, emit, pushArgs, repoPath);
  if (pushCode !== 0) {
    emit(`[gitdash] ✗ ${friendlyStepLabel("push")} didn't complete (exit ${pushCode}).`);
    if (isProtectedBranchError(run.lines)) {
      emitProtectedBranchHint(emit);
    } else {
      emit("[gitdash] hint: Your commit was saved locally. Once you fix the push issue (often a GitHub auth problem), click the Push button on this row to retry.");
      emitHint(emit, run.lines);
    }
    run.finishedAt = Date.now();
    run.exitCode = pushCode;
    recordRunFinish(run);
    run.emitter.emit("done", { exitCode: pushCode });
    return;
  }

  run.finishedAt = Date.now();
  run.exitCode = 0;
  recordRunFinish(run);
  run.emitter.emit("done", { exitCode: 0 });
}

async function executePublishToGithub(
  run: ActionRun,
  repoPath: string,
  opts: PublishOptions,
): Promise<void> {
  const emit = (text: string) => {
    run.lines.push(text);
    run.emitter.emit("line", text);
  };

  // Defensive: bail if repo already has an origin remote — gh repo create
  // would error out and the user would be confused. This catches the case
  // where a transient `unknown` remoteState landed the repo in local-only
  // even though it actually has a remote configured.
  try {
    const result = await execFileAsync("git", ["-C", repoPath, "config", "--get", "remote.origin.url"], {
      timeout: 5_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const url = result.stdout.trim();
    if (url) {
      emit(`[gitdash] ✗ This repo already has an 'origin' remote: ${url}`);
      emit("[gitdash] hint: Refresh the row to update its connection status — it may already be linked to GitHub.");
      run.finishedAt = Date.now();
      run.exitCode = 1;
      recordRunFinish(run);
      run.emitter.emit("done", { exitCode: 1 });
      return;
    }
  } catch {
    // No origin remote — proceed.
  }

  const visibilityFlag = opts.visibility === "public" ? "--public" : "--private";
  const args = [
    "repo",
    "create",
    opts.name,
    visibilityFlag,
    `--source=${repoPath}`,
    "--remote=origin",
    "--push",
  ];
  if (opts.description && opts.description.trim()) {
    args.push(`--description=${opts.description.trim().slice(0, 350)}`);
  }

  const code = await spawnGhStep(run, emit, args);
  run.finishedAt = Date.now();
  run.exitCode = code;
  recordRunFinish(run);
  if (code === 0) {
    emit(`[gitdash] ✓ Repository created and pushed to GitHub.`);
  } else {
    emit(`[gitdash] ✗ ${friendlyStepLabel("publish")} didn't complete (exit ${code}).`);
    emitHint(emit, run.lines);
  }
  run.emitter.emit("done", { exitCode: code });
}

/** Returns true if the accumulated lines indicate a GH013 protected-branch rejection. */
function isProtectedBranchError(lines: readonly string[]): boolean {
  const combined = lines.join("\n");
  return /GH013|protected branch hook declined|pre-receive hook declined.*protected/i.test(combined);
}

/** Emit a recovery marker the UI watches for, plus a human-readable hint. */
function emitProtectedBranchHint(emit: (text: string) => void): void {
  emit("[gitdash] hint: This branch is protected on GitHub — direct pushes are blocked by your repository settings.");
  emit("[gitdash] hint: You need to push to a separate branch and open a Pull Request for review.");
  emit("[gitdash:recover] create-pr");
}

/**
 * Sanitize a string into a safe branch-name slug:
 * lowercase, non-alphanumeric → '-', collapse repeats, max 40 chars, no trailing '-'.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
}

const DEFAULT_BRANCH_NAMES = new Set(["main", "master", "trunk"]);

/**
 * Multi-step action:
 * 1. Read current branch.
 * 2. If on a default branch, create a new feature branch.
 * 3. Push the branch to origin with -u.
 * 4. Open the GitHub PR form in the browser via `gh pr create --fill --web`.
 */
async function executeCreatePr(run: ActionRun, repoPath: string, _snapshotBranch: string | null): Promise<void> {
  const emit = (text: string) => {
    run.lines.push(text);
    run.emitter.emit("line", text);
  };

  // Step 1: resolve current branch
  emit("[gitdash] Step 1/4: Checking current branch…");
  let currentBranch: string;
  try {
    const result = await execFileAsync(
      "git",
      ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"],
      { timeout: 5_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );
    currentBranch = result.stdout.trim();
  } catch (err) {
    emit(`[gitdash] ✗ Could not determine current branch: ${(err as Error).message}`);
    run.finishedAt = Date.now();
    run.exitCode = 1;
    recordRunFinish(run);
    run.emitter.emit("done", { exitCode: 1 });
    return;
  }

  if (!currentBranch || currentBranch === "HEAD") {
    emit("[gitdash] ✗ You are in a detached HEAD state. Checkout a branch first.");
    run.finishedAt = Date.now();
    run.exitCode = 1;
    recordRunFinish(run);
    run.emitter.emit("done", { exitCode: 1 });
    return;
  }

  emit(`[gitdash] Current branch: ${currentBranch}`);

  // Step 2: if on a default branch, create a new feature branch
  let targetBranch = currentBranch;
  if (DEFAULT_BRANCH_NAMES.has(currentBranch)) {
    emit("[gitdash] Step 2/4: Creating a new feature branch…");

    // Get last commit subject for the slug
    let commitSubject = "";
    try {
      const logResult = await execFileAsync(
        "git",
        ["-C", repoPath, "log", "-1", "--format=%s"],
        { timeout: 5_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      );
      commitSubject = logResult.stdout.trim();
    } catch {
      // non-fatal; use empty slug
    }

    const slug = slugify(commitSubject) || "changes";
    const timestamp = Math.floor(Date.now() / 1000);
    targetBranch = `gitdash/${slug}-${timestamp}`;

    // assertSafeRef before passing to git
    try {
      assertSafeRef(targetBranch);
    } catch {
      // Fallback to a simple safe name if slug contains anything unexpected
      targetBranch = `gitdash/changes-${timestamp}`;
      assertSafeRef(targetBranch);
    }

    emit(`[gitdash] New branch: ${targetBranch}`);
    const checkoutCode = await spawnGitStep(run, emit, ["checkout", "-b", targetBranch], repoPath);
    if (checkoutCode !== 0) {
      emit(`[gitdash] ✗ Could not create branch '${targetBranch}' (exit ${checkoutCode}).`);
      run.finishedAt = Date.now();
      run.exitCode = checkoutCode;
      recordRunFinish(run);
      run.emitter.emit("done", { exitCode: checkoutCode });
      return;
    }
  } else {
    emit("[gitdash] Step 2/4: Already on a feature branch — skipping branch creation.");
  }

  // Step 3: push the branch
  emit(`[gitdash] Step 3/4: Pushing branch '${targetBranch}' to origin…`);
  const pushCode = await spawnGitStep(run, emit, ["push", "-u", "origin", "HEAD"], repoPath);
  if (pushCode !== 0) {
    emit(`[gitdash] ✗ Push failed (exit ${pushCode}).`);
    emitHint(emit, run.lines);
    run.finishedAt = Date.now();
    run.exitCode = pushCode;
    recordRunFinish(run);
    run.emitter.emit("done", { exitCode: pushCode });
    return;
  }

  // Step 4: open the GitHub PR form in the browser
  emit("[gitdash] Step 4/4: Opening GitHub Pull Request form in your browser…");
  const prCode = await spawnGhStep(run, emit, ["pr", "create", "--fill", "--web"], repoPath);
  run.finishedAt = Date.now();
  run.exitCode = prCode;
  recordRunFinish(run);
  if (prCode === 0) {
    emit("[gitdash] ✓ Your browser opened the Pull Request form on GitHub. Fill in the details and submit!");
  } else {
    emit(`[gitdash] ✗ Could not open GitHub PR form (exit ${prCode}).`);
    emitHint(emit, run.lines);
  }
  run.emitter.emit("done", { exitCode: prCode });
}

function spawnGhStep(
  run: ActionRun,
  emit: (text: string) => void,
  args: string[],
  cwd?: string,
): Promise<number> {
  return new Promise<number>((resolve) => {
    emit(`$ gh ${args.join(" ")}`);
    const child = spawn("gh", args, {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
    });
    run.child = child;
    const onData = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.length > 0) emit(line);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setTimeout(() => {
      emit("[timeout] SIGTERM");
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3_000);
    }, 120_000);
    child.on("close", (c) => {
      clearTimeout(timer);
      resolve(c ?? -1);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      const errno = err as NodeJS.ErrnoException;
      if (errno.code === "ENOENT") {
        emit("[gitdash] hint: GitHub CLI ('gh') isn't installed or isn't on PATH. Install it from https://cli.github.com.");
      } else {
        emit(`[error] ${err.message}`);
      }
      resolve(-1);
    });
  });
}

function getEditor(): string {
  return process.env.GITDASH_EDITOR || "code";
}

function getTerminal(): string {
  return process.env.GITDASH_TERMINAL || "x-terminal-emulator";
}

function executeRun(run: ActionRun, executable: string, args: string[], cwd?: string): void {
  const emit = (text: string) => {
    run.lines.push(text);
    run.emitter.emit("line", text);
  };

  emit(`$ ${executable} ${args.join(" ")}`);

  const isLaunch = run.action === "open-editor" || run.action === "open-terminal";
  const child = spawn(executable, args, {
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "/bin/echo",
    },
    stdio: isLaunch ? "ignore" : ["ignore", "pipe", "pipe"],
    cwd,
    detached: isLaunch,
  });
  if (isLaunch) {
    child.unref();
    emit(`launched ${executable} (detached) — gitdash is not tracking it`);
    run.finishedAt = Date.now();
    run.exitCode = 0;
    setImmediate(() => run.emitter.emit("done", { exitCode: 0 }));
    return;
  }
  run.child = child;

  const onData = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line.length > 0) emit(line);
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  const timeout = (run.action === "open-editor" || run.action === "open-terminal") ? 5_000 : 120_000;
  const timer = setTimeout(() => {
    if (run.finishedAt) return;
    emit("[timeout] SIGTERM");
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 3_000);
  }, timeout);

  child.on("close", (code) => {
    clearTimeout(timer);
    run.finishedAt = Date.now();
    run.exitCode = code ?? -1;
    if (run.exitCode !== 0) {
      emit(`[gitdash] ✗ ${friendlyActionLabel(run.action)} didn't complete (exit ${run.exitCode}).`);
      emitHint(emit, run.lines);
    }
    const truncated = run.lines.slice(-200).join("\n");
    getDb().prepare(
      "UPDATE actions_log SET finished_at = ?, exit_code = ?, truncated_output = ? WHERE repo_id = ? AND started_at = ?",
    ).run(run.finishedAt, run.exitCode, truncated, run.repoId, run.startedAt);
    run.emitter.emit("done", { exitCode: run.exitCode });
  });

  child.on("error", (err) => {
    clearTimeout(timer);
    emit(`[error] ${err.message}`);
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      if (run.action === "open-editor") {
        emit(`[gitdash] hint: gitdash couldn't launch your editor (${executable}). Set GITDASH_EDITOR to the command for your editor (e.g. 'code', 'subl', 'cursor').`);
      } else if (run.action === "open-terminal") {
        emit(`[gitdash] hint: gitdash couldn't launch your terminal (${executable}). Set GITDASH_TERMINAL to the command for your terminal.`);
      } else {
        emit(`[gitdash] hint: '${executable}' isn't installed or isn't on PATH for the gitdash process.`);
      }
    }
    run.finishedAt = Date.now();
    run.exitCode = -1;
    run.emitter.emit("done", { exitCode: -1 });
  });
}

const VALID_ACTIONS: ReadonlySet<string> = new Set([
  "fetch",
  "pull",
  "push",
  "merge",
  "stash-push",
  "stash-pop",
  "open-editor",
  "open-terminal",
  "commit",
  "commit-push",
  "publish-to-github",
  "create-pr",
]);

export function isValidAction(value: string): value is ActionName {
  return VALID_ACTIONS.has(value);
}
