import { confirmHire } from "@/server/hire";
import { openDb } from "@/server/db";
import { body, fail, json } from "@/server/api";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { id, signature } = await body<{ id: string; signature: string }>(req);
    openDb();
    confirmHire(id, signature);
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
