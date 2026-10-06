import { openDb, payoutsFor } from "@/server/db";
import { isPubkey } from "@/server/solana";
import { body, fail, json } from "@/server/api";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { wallet } = await body<{ wallet: string }>(req);
    if (!isPubkey(wallet)) throw new Error("Invalid wallet");
    openDb();
    return json({ payouts: payoutsFor(wallet) });
  } catch (e) {
    return fail(e);
  }
}
