// Phase 2 endpoint (STUB): Server-Sent Events stream of world snapshots/patches.
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response("Phase 2 backend not enabled: /api/stream is a stub.", { status: 501 });
}
