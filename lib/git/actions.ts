import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { assertSafeRef } from "./exec";
import { translateGitError, friendlyStepLabel } from "./error-hints";
import { getDb } from "@/lib/db/schema";

export type ActionName =
  | "fetch"
  | "pull"
  | "push"
  | "merge"
  | "stash-push"
  | "stash-pop"
  | "open-editor"
  | "open-terminal"
  | "commit-push";

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
  securityOverride?: boolean;
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

  if (opts.action === "commit-push") {
    const message = sanitizeCommitMessage(opts.commitMessage);
    const securityOverride = opts.securityOverride === true;
    setImmediate(() => {
      executeCommitPush(run, opts.repoPath, message, securityOverride).catch((err) => {
        run.emitter.emit("done", { exitCode: -1 });
        run.exitCode = -1;
        run.finishedAt = Date.now();
        recordRunFinish(run);
        // surface error
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
    case "commit-push":
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
    case "commit-push":
      return "Commit & push";
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

async function executeCommitPush(run: ActionRun, repoPath: string, message: string, securityOverride: boolean): Promise<void> {
  const emit = (text: string) => {
    run.lines.push(text);
    run.emitter.emit("line", text);
  };

  // Secret scan already ran in the action route before this point.
  // If securityOverride is true, the route confirmed the user acknowledged the risk.
  if (securityOverride) {
    emit("[secret-scan] ⚠ override — proceeding past secret findings as confirmed by user");
  } else {
    emit("[secret-scan] ✓ passed");
  }

  const steps: { label: string; args: string[] }[] = [
    { label: "stage", args: ["add", "-A"] },
    { label: "commit", args: ["commit", "-m", message] },
    { label: "push", args: ["push"] },
  ];

  for (const step of steps) {
    emit(`$ git ${step.args.join(" ")}`);
    const code = await new Promise<number>((resolve) => {
      const child = spawn("git", ["-C", repoPath, ...step.args], {
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

    if (code !== 0) {
      if (step.label === "commit" && code === 1) {
        // "nothing to commit" — treat as success, skip push
        emit("[gitdash] nothing to commit; skipping push");
        run.finishedAt = Date.now();
        run.exitCode = 0;
        recordRunFinish(run);
        run.emitter.emit("done", { exitCode: 0 });
        return;
      }
      emit(`[gitdash] ✗ ${friendlyStepLabel(step.label)} didn't complete (exit ${code}).`);
      emitHint(emit, run.lines);
      run.finishedAt = Date.now();
      run.exitCode = code;
      recordRunFinish(run);
      run.emitter.emit("done", { exitCode: code });
      return;
    }
  }

  run.finishedAt = Date.now();
  run.exitCode = 0;
  recordRunFinish(run);
  run.emitter.emit("done", { exitCode: 0 });
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
  "commit-push",
]);

export function isValidAction(value: string): value is ActionName {
  return VALID_ACTIONS.has(value);
}
