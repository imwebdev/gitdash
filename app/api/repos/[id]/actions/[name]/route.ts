import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { bootstrap } from "@/lib/bootstrap";
import { validateCsrf } from "@/lib/security/csrf";
import { getRepoById, getSnapshot } from "@/lib/db/repos";
import { isValidAction, startAction } from "@/lib/git/actions";
import { getScheduler } from "@/lib/scan/scheduler";
import { scanFiles } from "@/lib/security/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

/** Enumerate files that would be staged (modified, added, untracked). */
async function getStagingCandidates(repoPath: string): Promise<string[]> {
  let stdout = "";
  try {
    const result = await execFileAsync(
      "git",
      ["-C", repoPath, "status", "--porcelain=v1", "-z"],
      { env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/echo" }, timeout: 15_000 },
    );
    stdout = result.stdout;
  } catch {
    return [];
  }

  const paths: string[] = [];
  for (const chunk of stdout.split("\0")) {
    if (chunk.length < 4) continue;
    const xy = chunk.slice(0, 2);
    const filePath = chunk.slice(3);
    if (!filePath) continue;
    if (xy === "D " || xy === " D" || xy === "DD") continue;
    paths.push(filePath);
  }
  return paths;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; name: string }> },
) {
  await bootstrap();

  const csrf = req.headers.get("x-csrf-token");
  if (!validateCsrf(csrf)) {
    return NextResponse.json({ error: "invalid csrf" }, { status: 403 });
  }

  const { id, name } = await ctx.params;
  const repoId = Number(id);
  if (!Number.isInteger(repoId) || repoId <= 0) {
    return NextResponse.json({ error: "invalid repo id" }, { status: 400 });
  }
  if (!isValidAction(name)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  const repo = getRepoById(repoId);
  if (!repo || repo.deletedAt !== null) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }

  let commitMessage: string | undefined;
  let securityOverride = false;
  if (name === "commit-push") {
    try {
      const body = (await req.json()) as { commitMessage?: unknown; securityOverride?: unknown };
      if (typeof body.commitMessage === "string") {
        commitMessage = body.commitMessage;
      }
      if (body.securityOverride === true) {
        securityOverride = true;
      }
    } catch {
      // empty body is fine; sanitizer will use default
    }

    // Run secret scan before starting the action so we can return a structured
    // 422 response that the modal can render. This runs synchronously here so
    // the route can block the action before any git commands run.
    if (!securityOverride) {
      try {
        const candidates = await getStagingCandidates(repo.repoPath);
        // Guard path traversal
        const repoRoot = path.resolve(repo.repoPath);
        const repoRootPrefix = repoRoot.endsWith(path.sep) ? repoRoot : repoRoot + path.sep;
        const safeCandidates = candidates.filter((rel) => {
          const abs = path.resolve(repoRoot, rel);
          return abs === repoRoot || abs.startsWith(repoRootPrefix);
        });
        const findings = await scanFiles(repo.repoPath, safeCandidates);
        if (findings.length > 0) {
          return NextResponse.json(
            { error: "secret-scan-blocked", findings },
            { status: 422 },
          );
        }
      } catch {
        // If scan itself fails, allow the commit to proceed (fail-open)
      }
    }
  }

  const snap = getSnapshot(repoId);
  let run;
  try {
    run = startAction({
      repoId,
      repoPath: repo.repoPath,
      action: name,
      branch: snap?.branch ?? null,
      commitMessage,
      securityOverride,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }

  // Schedule a post-action refresh so the UI updates when the run completes
  run.emitter.once("done", () => {
    getScheduler()?.collectOne(repoId).catch(() => {});
  });

  return NextResponse.json({ runId: run.id });
}
