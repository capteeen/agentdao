import { getReport, hasRating, openDb, saveRating, saveReport } from "@/server/db";
import { isPubkey, ratingMessage, verifySigned } from "@/server/solana";
import { body, fail, json } from "@/server/api";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = await body<{ reportId: string; up: boolean; wallet: string; signature: string }>(req);
    openDb();
    const r = getReport(b.reportId);
    if (!r) throw new Error("No such report");
    if (!isPubkey(b.wallet)) throw new Error("Invalid wallet");
    if (hasRating(r.id, b.wallet)) throw new Error("Already rated");
    if (!verifySigned(ratingMessage(r.id, !!b.up), b.signature, b.wallet)) throw new Error("Bad signature");
    saveRating(r.id, b.wallet, !!b.up, b.signature);
    saveReport({ ...r, raters: r.raters + 1, up: r.up + (b.up ? 1 : 0), down: r.down + (b.up ? 0 : 1) });
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
