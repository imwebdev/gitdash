import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { assertSafeRef } from "./exec";
import { getDb } from "@/lib/db/schema";

export type ActionName =
  | "fetch"
  | "pull"
  | "push"
  | "merge"
  | "stash-push"
  | "stash-pop"
  | "open-editor";

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

  const args = buildArgs(opts.action, opts.branch);
  const executable = opts.action === "open-editor" ? getEditor() : "git";
  const spawnArgs = opts.action === "open-editor" ? [opts.repoPath] : ["-C", opts.repoPath, ...args];

  setImmediate(() => executeRun(run, executable, spawnArgs));

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
  }
}

function getEditor(): string {
  return process.env.GITDASH_EDITOR || process.env.VISUAL || process.env.EDITOR || "code";
}

function executeRun(run: ActionRun, executable: string, args: string[]): void {
  const emit = (text: string) => {
    run.lines.push(text);
    run.emitter.emit("line", text);
  };

  emit(`$ ${executable} ${args.join(" ")}`);

  const child = spawn(executable, args, {
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "/bin/echo",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  run.child = child;

  const onData = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line.length > 0) emit(line);
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  const timeout = run.action === "open-editor" ? 5_000 : 120_000;
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
    const truncated = run.lines.slice(-200).join("\n");
    getDb().prepare(
      "UPDATE actions_log SET finished_at = ?, exit_code = ?, truncated_output = ? WHERE repo_id = ? AND started_at = ?",
    ).run(run.finishedAt, run.exitCode, truncated, run.repoId, run.startedAt);
    run.emitter.emit("done", { exitCode: run.exitCode });
  });

  child.on("error", (err) => {
    clearTimeout(timer);
    emit(`[error] ${err.message}`);
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
]);

export function isValidAction(value: string): value is ActionName {
  return VALID_ACTIONS.has(value);
}
