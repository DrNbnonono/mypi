import { getRunningRpcSessionIds, subscribeRunningSessions } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/running/events - SSE stream of the set of currently-running
// session ids. Pushes an update whenever any session starts or stops working,
// so the sidebar never has to poll.
export async function GET(req: Request) {
  let cancelStream: (closeController: boolean) => void = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;
      let abortHandler: (() => void) | null = null;
      const cleanup = (closeController: boolean) => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        unsubscribe = null;
        if (abortHandler) req.signal.removeEventListener("abort", abortHandler);
        if (closeController) {
          try { controller.close(); } catch { /* already closed */ }
        }
      };
      cancelStream = cleanup;
      const encode = (data: unknown) => {
        if (closed) return;
        const text = `data: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup(false);
        }
      };

      // Subscribe BEFORE taking the initial snapshot so no state change can slip
      // through the gap between snapshot and subscription.
      unsubscribe = subscribeRunningSessions((ids) => encode({ type: "running", runningSessionIds: ids }));

      // Initial snapshot so the client renders the correct state immediately.
      // (A duplicate frame here is harmless: the client just sets the same set.)
      encode({ type: "running", runningSessionIds: getRunningRpcSessionIds() });

      // Heartbeat to keep the connection alive through proxies/timeouts.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          cleanup(false);
        }
      }, 30_000);

      abortHandler = () => cleanup(true);
      if (req.signal.aborted) cleanup(true);
      else req.signal.addEventListener("abort", abortHandler, { once: true });
    },
    cancel() {
      cancelStream(false);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
