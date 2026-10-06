import { castBallot } from "@/server/governance";
import { openDb } from "@/server/db";
import { body, fail, json } from "@/server/api";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = await body<{ voteId: string; option: string; wallet: string; signature: string; paperWeight?: number }>(req);
    openDb();
    const v = castBallot(b);
    return json({ ok: true, tallies: v.tallies });
  } catch (e) {
    return fail(e);
  }
}
