import type { StreamEvent } from "@/contracts";
import { subscribeStream } from "@/server/bus";
import { getConfig } from "@/server/config";

export const dynamic = "force-dynamic";

/**
 * Server-sent events: every persisted row change, pushed as it happens.
 * Clients upsert the payload into local state; `heartbeat` keeps the
 * connection alive through proxies and lets clients show liveness.
 */
export async function GET(request: Request): Promise<Response> {
  const heartbeatMs = getConfig().stream.heartbeatMs;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          unsubscribe();
          clearInterval(heartbeat);
        }
      };
      const unsubscribe = subscribeStream(send);
      const heartbeat = setInterval(() => {
        send({ type: "heartbeat", at: new Date().toISOString() });
      }, heartbeatMs);
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
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
