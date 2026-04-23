import { bootstrap } from "@/lib/bootstrap";
import { getStore } from "@/lib/state/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  await bootstrap();
  const url = new URL(req.url);
  const includeSystem = url.searchParams.get("showSystem") === "1";
  const store = getStore();
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

      // Initial snapshot
      send("snapshot", { repos: store.snapshot(includeSystem) });

      const pushUpdate = (repoId: number) => {
        send("update", { repoId });
      };
      const pushBulk = () => {
        send("bulk", { repos: store.snapshot(includeSystem) });
      };
      const pushPing = () => send("ping", { t: Date.now() });

      store.on("update", pushUpdate);
      store.on("bulk", pushBulk);
      const pingTimer = setInterval(pushPing, 20_000);

      const abort = () => {
        clearInterval(pingTimer);
        store.off("update", pushUpdate);
        store.off("bulk", pushBulk);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", abort);
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
