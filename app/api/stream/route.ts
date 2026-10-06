// SSE: one snapshot, then id-keyed patches whenever the worker (or an API
// call) changes something. Clients merge patches by id (lib/backend/live.ts).
import { changesSince, latestSeq, loadWorld, openDb } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  openDb();
  const enc = new TextEncoder();
  let seq = latestSeq();
  let timer: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      send({ type: "snapshot", world: loadWorld({ trades: 600, events: 150, reports: 300 }) });
      timer = setInterval(() => {
        try {
          const p = changesSince(seq);
          if (p.seq > seq) {
            seq = p.seq;
            send({ type: "patch", world: p.world });
          } else controller.enqueue(enc.encode(": ping\n\n"));
        } catch (e) {
          controller.error(e);
        }
      }, 1000);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
