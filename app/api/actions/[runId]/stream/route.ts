import { getRun } from "@/lib/git/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  const { runId } = await ctx.params;
  const run = getRun(runId);
  if (!run) {
    return new Response("not found", { status: 404 });
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
          // already closed
        }
      };

      for (const text of run.lines) send("line", { text });
      if (run.finishedAt !== null) {
        send("done", { exitCode: run.exitCode });
        controller.close();
        return;
      }

      const onLine = (text: string) => send("line", { text });
      const onDone = (payload: { exitCode: number }) => {
        send("done", payload);
        run.emitter.off("line", onLine);
        try {
          controller.close();
        } catch {
          // ignore
        }
      };
      run.emitter.on("line", onLine);
      run.emitter.once("done", onDone);

      req.signal.addEventListener("abort", () => {
        run.emitter.off("line", onLine);
        run.emitter.off("done", onDone);
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
