// Phase 2 (STUB): deterministic rule engines. No LLM decides anything.
//
// Each strategy is a pure function (market snapshot, rules, vault) -> intents.
// The executor turns intents into PumpPortal txs signed by the agent key.
// The LLM (explain.ts) only writes the one-line `reason` AFTER the fact, from
// the intent's structured `why` — so the "why" is always the rule, not vibes.

import type { RuleField, RuleSet } from "../types";
import { RISK_PCT } from "../rules";

export interface MarketSnapshot {
  newLaunches: { mint: string; ticker: string; ageBlocks: number; devPct: number }[];
  movers: { mint: string; ticker: string; move5m: number }[];
  copyBuys: { wallet: string; mint: string; ticker: string }[];
  positions: { mint: string; ticker: string; mult: number; size: number }[];
}

export interface Intent {
  kind: "buy" | "sell" | "launch";
  mint?: string;
  ticker?: string;
  sizeSol: number;
  rule: RuleField; // which rule produced this — linked to the vote that set it
  why: Record<string, string | number>;
}

export function decide(m: MarketSnapshot, rules: RuleSet, vault: number): Intent[] {
  const size = vault * Math.min(RISK_PCT[rules.risk], 0.9);
  const out: Intent[] = [];
  const tp = { "2x": 2, "5x": 5, "10x": 10, never: Infinity }[rules.takeProfit];
  for (const p of m.positions) {
    if (p.mult >= tp) out.push({ kind: "sell", mint: p.mint, ticker: p.ticker, sizeSol: p.size, rule: "takeProfit", why: { mult: p.mult } });
    else if (p.mult <= 0.5) out.push({ kind: "sell", mint: p.mint, ticker: p.ticker, sizeSol: p.size, rule: "risk", why: { stop: -50 } });
  }
  switch (rules.strategy) {
    case "sniper": {
      const c = m.newLaunches.find((l) => l.ageBlocks <= 3 && l.devPct < 10);
      if (c) out.push({ kind: "buy", mint: c.mint, ticker: c.ticker, sizeSol: size, rule: "strategy", why: { ageBlocks: c.ageBlocks, devPct: c.devPct } });
      break;
    }
    case "momentum": {
      const c = m.movers.find((x) => x.move5m >= 0.4);
      if (c) out.push({ kind: "buy", mint: c.mint, ticker: c.ticker, sizeSol: size, rule: "strategy", why: { move5m: c.move5m } });
      break;
    }
    case "copytrade": {
      const c = m.copyBuys.find((x) => x.wallet === rules.copyWallet);
      if (c) out.push({ kind: "buy", mint: c.mint, ticker: c.ticker, sizeSol: size, rule: "strategy", why: { wallet: c.wallet } });
      break;
    }
    case "feefarmer":
      break; // launches are driven by the cadence scheduler
  }
  return out;
}
