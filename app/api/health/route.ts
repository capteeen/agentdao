import { getKv, openDb } from "@/server/db";
import { CFG } from "@/server/config";
import { json } from "@/server/api";
export const dynamic = "force-dynamic";
export async function GET() {
  openDb();
  return json({ ok: true, mode: CFG.mode, market: CFG.market, slot: getKv("slot", 0), lastReport: getKv("lastReport", 0) });
}
