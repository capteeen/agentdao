// Creator-fee claims and pro-rata payouts to holders.
//
// live:  collectCreatorFee via PumpPortal (the agent is the creator of every
//        coin it launched), then batched SystemProgram transfers to the latest
//        holder snapshot. Dust below 0.0005 SOL is skipped (rent-exempt noise).
// paper: accounting rows in `payouts`, which /api/holdings turns into "claimable".

import { SystemProgram, Transaction, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import type { Agent } from "../lib/types";
import { CFG } from "./config";
import { getKey, openDb, savePayout, type Snapshot } from "./db";
import * as pp from "./pumpportal";
import { connection, keypairFrom, snapshotHolders, solBalance } from "./solana";

const MIN_PAYOUT = 0.0005;
const LAMPORTS = 1_000_000_000;

/** Latest holder snapshot for the agent's coin (or the owner-only paper distribution). */
async function holdersFor(a: Agent): Promise<Snapshot["balances"]> {
  if (CFG.mode === "live") return (await snapshotHolders(a.coinCa, [a.wallet])).balances;
  // paper: most recent vote snapshot if any, else the owner.
  const row = openDb().prepare("SELECT json FROM snapshots WHERE json LIKE ? ORDER BY rowid DESC LIMIT 1").get(`%"mint":"${a.coinCa}"%`) as { json: string } | undefined;
  const snap = row ? (JSON.parse(row.json) as Snapshot) : undefined;
  return snap?.balances ?? { [a.ownerWallet]: a.supply * 0.04 };
}

/** Claim creator fees into the agent wallet. Returns SOL claimed. */
export async function claimFees(a: Agent, now: number): Promise<number> {
  if (CFG.mode !== "live") return 0; // paper fees accrue per observed buy (worker.market.onTrade)
  const key = getKey(a.id);
  if (!key) return 0;
  const kp = keypairFrom(key.encrypted);
  const before = await solBalance(a.wallet);
  try {
    await pp.collectCreatorFee(kp);
  } catch (e) {
    // nothing to collect is a normal failure
    if (!/no fees|nothing/i.test((e as Error).message)) throw e;
    return 0;
  }
  const after = await solBalance(a.wallet);
  void now;
  return Math.max(0, after - before);
}

/** Pay `total` SOL pro-rata to holders. Returns what was paid and to how many. */
export async function distribute(a: Agent, total: number, kind: "fees" | "liquidation", voteId: string | undefined, now: number): Promise<{ total: number; count: number }> {
  if (total <= 0) return { total: 0, count: 0 };
  const balances = await holdersFor(a);
  const sum = Object.values(balances).reduce((s, x) => s + x, 0);
  if (!sum) return { total: 0, count: 0 };
  const shares = Object.entries(balances)
    .map(([wallet, bal]) => ({ wallet, sol: (total * bal) / sum }))
    .filter((s) => s.sol >= MIN_PAYOUT)
    .sort((x, y) => y.sol - x.sol);
  let paid = 0;
  if (CFG.mode === "live") {
    const key = getKey(a.id);
    if (!key) throw new Error("no key");
    const kp = keypairFrom(key.encrypted);
    // ~18 transfers per tx keeps us under the size limit
    for (let i = 0; i < shares.length; i += 18) {
      const batch = shares.slice(i, i + 18);
      const tx = new Transaction();
      for (const s of batch) tx.add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(s.wallet), lamports: Math.floor(s.sol * LAMPORTS) }));
      const sig = await sendAndConfirmTransaction(connection(), tx, [kp], { commitment: "confirmed" });
      for (const s of batch) {
        savePayout({ agentId: a.id, wallet: s.wallet, sol: s.sol, kind, at: now, tx: sig });
        paid += s.sol;
      }
    }
  } else {
    for (const s of shares) {
      savePayout({ agentId: a.id, wallet: s.wallet, sol: +s.sol.toFixed(6), kind, at: now, tx: voteId });
      paid += s.sol;
    }
  }
  return { total: +paid.toFixed(6), count: shares.length };
}
