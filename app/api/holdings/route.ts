// Voting-weight source: token balances per agent for a wallet (live: RPC; paper: owner dev buy + self-declared demo stake).
import { loadWorld, openDb, unclaimedFees } from "@/server/db";
import { CFG } from "@/server/config";
import { balanceOf, isPubkey } from "@/server/solana";
import { body, fail, json } from "@/server/api";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { wallet } = await body<{ wallet: string }>(req);
    if (!isPubkey(wallet)) throw new Error("Invalid wallet");
    openDb();
    const w = loadWorld({ trades: 0, events: 0, reports: 0 });
    const holdings: Record<string, number> = {};
    for (const a of Object.values(w.agents)) {
      if (CFG.mode === "live") {
        try {
          const b = await balanceOf(a.coinCa, wallet);
          if (b > 0) holdings[a.id] = b;
        } catch {}
      } else if (a.ownerWallet === wallet) holdings[a.id] = Math.floor(a.supply * 0.04);
    }
    // paper mode: a demo wallet may self-declare a small stake (0.5%) in any agent so visitors can try governance
    return json({ holdings, claimable: unclaimedFees(wallet), demoStake: CFG.mode === "paper" ? Math.floor(CFG.supply * 0.005) : 0 });
  } catch (e) {
    return fail(e);
  }
}
