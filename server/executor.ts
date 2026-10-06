// Turns Intents into trades. Two modes:
//  - paper: fills at the market's last price with pump.fun's 1% fee and a
//    slippage model; positions, vault and PnL are accounting only.
//  - live:  PumpPortal trade-local txs signed with the agent's key; positions
//    are reconciled from the tx and the bonding curve.
// Both record identical Trade rows, so the UI is mode-agnostic.

import type { Intent } from "../lib/phase2/engine";
import type { Agent, Trade } from "../lib/types";
import { LABEL, RISK_PCT } from "../lib/rules";
import { fakeMint, fakeSig, mulberry32, type Rng } from "../lib/util";
import { CFG } from "./config";
import { deletePosition, getKey, getPositions, savePosition, type Position } from "./db";
import { explain } from "./explain";
import type { Market } from "./market";
import * as pp from "./pumpportal";
import { fetchCurve, keypairFrom, quoteBuy, quoteSell } from "./solana";

const FEE = 0.01; // pump.fun swap fee
const rng: Rng = mulberry32((Date.now() ^ 0x51ed) >>> 0);

export interface ExecResult {
  trade: Omit<Trade, "id">;
  patch: Partial<Agent>;
}

function sizeFor(a: Agent, intent: Intent) {
  return Math.max(0.01, Math.min(intent.sizeSol, a.vault * 0.98));
}

async function fill(a: Agent, mint: string, side: "buy" | "sell", amount: number, market: Market): Promise<{ sol: number; tokens: number; price: number; sig?: string }> {
  if (CFG.mode === "live") {
    const key = getKey(a.id);
    if (!key) throw new Error(`agent ${a.id} has no key`);
    const kp = keypairFrom(key.encrypted);
    const curve = await fetchCurve(mint);
    if (!curve) throw new Error(`no bonding curve for ${mint} (graduated?)`);
    if (side === "buy") {
      const sig = await pp.buy(kp, mint, amount);
      const tokens = quoteBuy(curve, amount * (1 - FEE));
      return { sol: amount, tokens, price: amount / tokens, sig };
    }
    const sig = await pp.sell(kp, mint, 100);
    const sol = quoteSell(curve, amount) * (1 - FEE);
    return { sol, tokens: amount, price: sol / amount, sig };
  }
  // paper
  const px = market.price(mint) || 2.8e-8;
  const slip = 1 + Math.min(0.08, (side === "buy" ? amount : amount * px) * 0.02); // bigger orders move the curve
  if (side === "buy") {
    const p = px * slip;
    const tokens = (amount * (1 - FEE)) / p;
    return { sol: amount, tokens, price: p };
  }
  const p = px / slip;
  return { sol: amount * p * (1 - FEE), tokens: amount, price: p };
}

/** Execute one intent for an agent. Returns the trade + agent patch, or null if nothing happened. */
export async function execute(a: Agent, intent: Intent, market: Market, now: number): Promise<ExecResult | null> {
  const src = (f: keyof Agent["ruleSource"]) => a.ruleSource[f] ?? "hire";
  const R = a.rules;

  if (intent.kind === "launch") {
    const devBuy = Math.min(sizeFor(a, intent), 1.5);
    let mint: string, sig: string | undefined;
    if (CFG.mode === "live") {
      const key = getKey(a.id);
      if (!key) throw new Error("no key");
      const uri = await pp.uploadMetadata({ name: intent.ticker ?? "BOSS LAUNCH", symbol: intent.ticker ?? "LAUNCH", description: `Launched by $${a.ticker}, an employee of its holders. boss.fun`, image: new Blob([Buffer.alloc(0)], { type: "image/png" }) });
      const r = await pp.create(keypairFrom(key.encrypted), { name: intent.ticker ?? "LAUNCH", symbol: intent.ticker ?? "LAUNCH", uri }, devBuy);
      mint = r.mint;
      sig = r.sig;
    } else {
      mint = fakeMint(rng);
      sig = fakeSig(rng);
      market.ingest({ kind: "launch", mint, ticker: intent.ticker ?? "LAUNCH", name: intent.ticker ?? "LAUNCH", creator: a.wallet, devBuySol: devBuy, price: 2.8e-8, at: now });
    }
    // the dev buy is a position too
    const f = await fill(a, mint, "buy", devBuy, market);
    savePosition({ agentId: a.id, mint, ticker: intent.ticker ?? "LAUNCH", tokens: f.tokens, costSol: devBuy, openedAt: now, entryPrice: f.price, strategy: R.strategy, voteId: src("cadence") });
    const reason = await explain({ ...intent, why: { ...intent.why, devBuy } }, R, a.ticker);
    return {
      trade: { agentId: a.id, kind: "launch", coinCa: mint, coinTicker: intent.ticker ?? "LAUNCH", amount: +devBuy.toFixed(4), reason, ruleApplied: `Launch cadence: ${LABEL[R.cadence]}`, ruleField: "cadence", voteId: src("cadence"), at: now, txSig: sig },
      patch: { vault: +(a.vault - devBuy).toFixed(4), lastAction: { kind: "launch", at: now }, nextTradeAt: undefined },
    };
  }

  if (intent.kind === "buy") {
    const sol = sizeFor(a, intent);
    if (sol < 0.01 || !intent.mint) return null;
    const f = await fill(a, intent.mint, "buy", sol, market);
    const existing = getPositions(a.id).find((p) => p.mint === intent.mint);
    savePosition({
      agentId: a.id,
      mint: intent.mint,
      ticker: intent.ticker ?? market.ticker(intent.mint),
      tokens: (existing?.tokens ?? 0) + f.tokens,
      costSol: (existing?.costSol ?? 0) + sol,
      openedAt: existing?.openedAt ?? now,
      entryPrice: f.price,
      strategy: R.strategy,
      voteId: src("strategy"),
    });
    const reason = await explain(intent, R, a.ticker, { sizePct: RISK_PCT[R.risk] });
    return {
      trade: { agentId: a.id, kind: "buy", coinCa: intent.mint, coinTicker: intent.ticker ?? market.ticker(intent.mint), amount: +sol.toFixed(4), reason, ruleApplied: `Strategy: ${LABEL[R.strategy]}`, ruleField: "strategy", voteId: src("strategy"), at: now, txSig: f.sig },
      patch: { vault: +(a.vault - sol).toFixed(4), lastAction: { kind: "buy", at: now }, nextTradeAt: undefined },
    };
  }

  // sell: close the whole position
  const pos = getPositions(a.id).find((p) => p.mint === intent.mint);
  if (!pos || !intent.mint) return null;
  const f = await fill(a, intent.mint, "sell", pos.tokens, market);
  deletePosition(a.id, intent.mint);
  const pnl = +(f.sol - pos.costSol).toFixed(4);
  const mult = pos.costSol > 0 ? f.sol / pos.costSol : 1;
  const field = intent.rule === "takeProfit" ? "takeProfit" : "risk";
  const why: Record<string, number> = field === "takeProfit" ? { mult } : { stop: (mult - 1) * 100 };
  const reason = await explain({ ...intent, rule: field, why }, R, a.ticker, { mult });
  const last = a.pnlHistory[a.pnlHistory.length - 1] ?? 0;
  return {
    trade: { agentId: a.id, kind: "sell", coinCa: intent.mint, coinTicker: pos.ticker, amount: +pos.costSol.toFixed(4), pnl, reason, ruleApplied: field === "takeProfit" ? `Take profit: ${LABEL[R.takeProfit]}` : `Risk: ${LABEL[R.risk]}`, ruleField: field, voteId: src(field), at: now, txSig: f.sig },
    patch: {
      vault: +(a.vault + f.sol).toFixed(4),
      pnl7d: +(a.pnl7d + pnl).toFixed(4),
      pnlHistory: [...a.pnlHistory, +(last + pnl).toFixed(4)].slice(-60),
      lossStreak: pnl < 0 ? a.lossStreak + 1 : 0,
      lastAction: { kind: "sell", at: now },
      nextTradeAt: undefined,
    },
  };
}

/** Sell everything an agent holds (firing / bankruptcy). Returns SOL recovered. */
export async function liquidateAll(a: Agent, market: Market, now: number): Promise<{ sol: number; trades: Omit<Trade, "id">[] }> {
  let sol = 0;
  const trades: Omit<Trade, "id">[] = [];
  for (const p of getPositions(a.id)) {
    try {
      const f = await fill(a, p.mint, "sell", p.tokens, market);
      deletePosition(a.id, p.mint);
      sol += f.sol;
      trades.push({ agentId: a.id, kind: "sell", coinCa: p.mint, coinTicker: p.ticker, amount: +p.costSol.toFixed(4), pnl: +(f.sol - p.costSol).toFixed(4), reason: `Fired: liquidated $${p.ticker} so the vault can be paid out to holders.`, ruleApplied: "Fire vote", ruleField: "risk", voteId: a.lastOrderVote ?? "hire", at: now, txSig: f.sig });
    } catch (e) {
      console.error("liquidate", a.id, p.mint, (e as Error).message);
    }
  }
  return { sol, trades };
}

export const positionsOf = (a: Agent): Position[] => getPositions(a.id);
