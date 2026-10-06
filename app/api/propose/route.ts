import { openVote, verifyProposalFee } from "@/server/governance";
import { getAgent, getKv, loadWorld, openDb, saveAgent } from "@/server/db";
import { CFG } from "@/server/config";
import { isPubkey, verifySigned } from "@/server/solana";
import { body, fail, json } from "@/server/api";
import { liveVotes } from "@/lib/sim";
import type { VoteField } from "@/lib/types";
export const dynamic = "force-dynamic";

const FIELDS: VoteField[] = ["strategy", "risk", "cadence", "takeProfit", "salaryPct", "raise", "fire"];

export async function POST(req: Request) {
  try {
    const b = await body<{ agentId: string; field: VoteField; wallet: string; reason?: string; feeTx?: string; signature?: string }>(req);
    openDb();
    const a = getAgent(b.agentId);
    if (!a || (a.status !== "working" && a.status !== "idle")) throw new Error("Agent is not employed");
    if (!FIELDS.includes(b.field)) throw new Error("Bad field");
    if (!isPubkey(b.wallet)) throw new Error("Invalid wallet");
    if (liveVotes(loadWorld({ trades: 0, events: 0, reports: 0 })).some((v) => v.agentId === a.id && v.field === b.field)) throw new Error("A vote on that is already live");
    // Proposer must be a holder (live: checked at snapshot via the fee tx + balance; paper: the signed intent is enough)
    if (CFG.mode === "live") await verifyProposalFee(b.wallet, a, b.feeTx);
    else if (!b.signature || !verifySigned(`BOSS propose ${a.id} ${b.field}`, b.signature, b.wallet)) throw new Error("Bad signature");
    const v = await openVote(a, b.field, b.wallet, b.reason?.slice(0, 140), Date.now(), getKv("slot", 0));
    if (CFG.mode !== "live") saveAgent({ ...a, vault: +(a.vault + CFG.proposalFeeSol).toFixed(6) });
    return json({ id: v.id });
  } catch (e) {
    return fail(e);
  }
}
