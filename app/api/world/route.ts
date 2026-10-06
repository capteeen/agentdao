import { loadWorld, openDb } from "@/server/db";
import { json } from "@/server/api";
export const dynamic = "force-dynamic";
export async function GET() {
  openDb();
  return json(loadWorld({ trades: 600, events: 150, reports: 300 }));
}
