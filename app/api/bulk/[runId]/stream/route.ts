import { bootstrap } from "@/lib/bootstrap";
import { getBulkRun } from "@/lib/bulk/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  await bootstrap();

  const { runId } = await ctx.params;
  const run = getBulkRun(runId);
  if (!run) {
    return new Response(
      JSON.stringify({ error: "run not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // stream already closed
        }
      };

      // Replay any statuses that already progressed before the client connected
      for (const repo of run.repos) {
        const status = run.statuses.get(repo.id);
        if (!status) continue;
        if (status.phase === "pulling") {
          send("start", { repoId: repo.id, name: repo.name });
        } else if (status.phase === "done") {
          send("start", { repoId: repo.id, name: repo.name });
          send("done", { repoId: repo.id });
        } else if (status.phase === "failed") {
          send("start", { repoId: repo.id, name: repo.name });
          send("error", { repoId: repo.id, message: status.message });
        }
      }

      // Forward live events
      const onStart = (data: { repoId: number; name: string }) => send("start", data);
      const onDone = (data: { repoId: number }) => send("done", data);
      const onError = (data: { repoId: number; message: string }) => send("error", data);
      const onSummary = (data: { ok: number; failed: Array<{ name: string; message: string }> }) => {
        send("summary", data);
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      };

      run.emitter.on("start", onStart);
      run.emitter.on("done", onDone);
      run.emitter.on("error", onError);
      run.emitter.on("summary", onSummary);

      const cleanup = () => {
        run.emitter.off("start", onStart);
        run.emitter.off("done", onDone);
        run.emitter.off("error", onError);
        run.emitter.off("summary", onSummary);
      };

      req.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
