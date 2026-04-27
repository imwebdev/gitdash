import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import pLimit from "p-limit";
import { bootstrap } from "@/lib/bootstrap";
import { validateCsrf } from "@/lib/security/csrf";
import { getStore } from "@/lib/state/store";
import { getScheduler } from "@/lib/scan/scheduler";
import { getDb } from "@/lib/db/schema";
import { setBulkRun, gcBulkRuns, type BulkRun, type RepoRunStatus } from "@/lib/bulk/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Plain-English error translation
// ---------------------------------------------------------------------------
function friendlyPullError(stderr: string): string {
  if (
    stderr.includes("Not possible to fast-forward") ||
    stderr.includes("Cannot fast-forward")
  ) {
    return "Has changes the bulk pull can't safely combine — open the repo to handle";
  }
  if (stderr.includes("CONFLICT")) {
    return "Has changes the bulk pull can't safely combine — open the repo to handle";
  }
  if (
    stderr.includes("Permission denied") ||
    stderr.includes("authentication") ||
    stderr.includes("could not read Username")
  ) {
    return "GitHub authentication failed — check that gh is signed in";
  }
  if (stderr.includes("no tracking information") || stderr.includes("no upstream")) {
    return "No upstream branch configured — open the repo to set one up";
  }
  const trimmed = stderr.trim().split("\n").pop() ?? stderr.trim();
  return trimmed.slice(0, 200) || "Pull failed — open the repo to see what went wrong";
}

// ---------------------------------------------------------------------------
// Single-repo pull (ff-only, no shell)
// ---------------------------------------------------------------------------
function pullRepo(
  run: BulkRun,
  repoId: number,
  repoPath: string,
  repoName: string,
): Promise<void> {
  return new Promise<void>((resolve) => {
    run.statuses.set(repoId, { phase: "pulling" });
    run.emitter.emit("start", { repoId, name: repoName });

    const stderrLines: string[] = [];

    const child = spawn("git", ["-C", repoPath, "pull", "--ff-only"], {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "/bin/echo",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) stderrLines.push(line);
      }
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3_000);
    }, 120_000);

    child.on("close", (code) => {
      clearTimeout(timer);

      // Log to actions_log (best-effort)
      try {
        const now = Date.now();
        getDb()
          .prepare(
            "INSERT INTO actions_log (repo_id, action, started_at, finished_at, exit_code, truncated_output) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            repoId,
            "pull",
            now,
            now,
            code ?? -1,
            stderrLines.slice(-50).join("\n"),
          );
      } catch {
        // best-effort
      }

      if (code === 0) {
        run.statuses.set(repoId, { phase: "done" });
        run.emitter.emit("done", { repoId });
        // Trigger a local snapshot so the UI row updates
        getScheduler()?.collectOne(repoId).catch(() => {});
      } else {
        const message = friendlyPullError(stderrLines.join("\n"));
        run.statuses.set(repoId, { phase: "failed", message });
        run.emitter.emit("error", { repoId, message });
      }
      resolve();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const message = `Could not run git: ${err.message}`;
      run.statuses.set(repoId, { phase: "failed", message });
      run.emitter.emit("error", { repoId, message });
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// POST /api/bulk/pull
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  await bootstrap();

  const csrf = req.headers.get("x-csrf-token");
  if (!validateCsrf(csrf)) {
    return NextResponse.json({ error: "invalid csrf" }, { status: 403 });
  }

  gcBulkRuns();

  const store = getStore();
  const allRepos = store.snapshot(false);
  const behindRepos = allRepos.filter((r) => r.derivedState === "behind");

  if (behindRepos.length === 0) {
    return NextResponse.json({ error: "no repos are behind" }, { status: 422 });
  }
  if (behindRepos.length > 50) {
    return NextResponse.json(
      {
        error: `${behindRepos.length} repos are behind — narrow scope first (max 50 per bulk pull)`,
      },
      { status: 422 },
    );
  }

  const bulkRunId = randomBytes(16).toString("base64url");
  const run: BulkRun = {
    repos: behindRepos.map((r) => ({ id: r.id, name: r.displayName, path: r.repoPath })),
    statuses: new Map<number, RepoRunStatus>(behindRepos.map((r) => [r.id, { phase: "queued" }])),
    emitter: new EventEmitter(),
    startedAt: Date.now(),
  };
  // Allow many listeners (one per SSE subscriber)
  run.emitter.setMaxListeners(20);

  setBulkRun(bulkRunId, run);

  // Execute pulls concurrently (limit 4), non-blocking
  const limit = pLimit(4);
  void Promise.all(
    run.repos.map((r) => limit(() => pullRepo(run, r.id, r.path, r.name))),
  ).then(() => {
    const ok = run.repos.filter((r) => {
      const s = run.statuses.get(r.id);
      return s?.phase === "done";
    });
    const failed = run.repos
      .filter((r) => {
        const s = run.statuses.get(r.id);
        return s?.phase === "failed";
      })
      .map((r) => {
        const s = run.statuses.get(r.id) as { phase: "failed"; message: string };
        return { name: r.name, message: s.message };
      });
    run.emitter.emit("summary", { ok: ok.length, failed });
  });

  return NextResponse.json({ bulkRunId });
}
