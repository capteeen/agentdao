// env for these tests lives in vitest.config.mts (CFG reads it at import time)
import { beforeEach, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { changesSince, closeDb, getPositions, latestSeq, loadWorld, openDb, persistDiff, savePosition } from "./db";
import { ballotMessage, decodeCurve, curvePrice, decryptSecret, encryptSecret, quoteBuy, quoteSell, signMessage, transferAmount, verifySigned } from "./solana";
import { castBallot, openVote, tally } from "./governance";
import { Market, SyntheticFeed } from "./market";
import { parseFeedMessage, type FeedEvent } from "./pumpportal";
import { execute } from "./executor";
import { hire, validateHire } from "./hire";
import { templateReason } from "./explain";
import { decide } from "../lib/phase2/engine";
import { agentList, createWorld, emptyWorld } from "../lib/sim";
import type { Agent } from "../lib/types";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";

const NOW = 1_800_000_000_000;

function freshDb() {
  closeDb();
  openDb(":memory:");
}
function seededAgent(): Agent {
  const w = createWorld(1337, NOW);
  persistDiff(emptyWorld(), w, NOW);
  return agentList(w).find((a) => a.status === "working")!;
}

describe("db", () => {
  beforeEach(freshDb);
  it("persists diffs and replays them as id-keyed patches", () => {
    const w = createWorld(1337, NOW);
    persistDiff(emptyWorld(), w, NOW);
    const loaded = loadWorld();
    expect(Object.keys(loaded.agents).length).toBe(Object.keys(w.agents).length);
    expect(loaded.trades.length).toBe(w.trades.length);
    const seq = latestSeq();
    // mutate one agent and add a trade
    const a = agentList(w)[0];
    const next = { ...w, agents: { ...w.agents, [a.id]: { ...a, vault: 123 } }, trades: [{ ...w.trades[0], id: "tNEW", at: NOW + 1 }, ...w.trades] };
    persistDiff(w, next, NOW + 1);
    const p = changesSince(seq);
    expect(Object.keys(p.world.agents!)).toEqual([a.id]);
    expect(p.world.agents![a.id].vault).toBe(123);
    expect(p.world.trades!.map((t) => t.id)).toEqual(["tNEW"]);
    expect(p.world.votes).toBeUndefined();
  });
});

describe("solana primitives", () => {
  it("round-trips an encrypted secret key", () => {
    const kp = Keypair.generate();
    const blob = encryptSecret(kp.secretKey);
    expect(blob.split(":")).toHaveLength(3);
    expect(Buffer.from(decryptSecret(blob))).toEqual(Buffer.from(kp.secretKey));
  });
  it("verifies ed25519 ballots and rejects tampering", () => {
    const kp = Keypair.generate();
    const w = kp.publicKey.toBase58();
    const sig = signMessage(ballotMessage("v1", "degen"), kp);
    expect(verifySigned(ballotMessage("v1", "degen"), sig, w)).toBe(true);
    expect(verifySigned(ballotMessage("v1", "intern"), sig, w)).toBe(false);
    expect(verifySigned(ballotMessage("v1", "degen"), sig, Keypair.generate().publicKey.toBase58())).toBe(false);
    expect(verifySigned("x", "not-base58!!", w)).toBe(false);
  });
  it("decodes a pump.fun bonding curve and quotes the constant product", () => {
    const b = Buffer.alloc(49);
    b.writeBigUInt64LE(1_073_000_000_000_000n, 8); // virtual tokens (1.073B * 1e6)
    b.writeBigUInt64LE(30_000_000_000n, 16); // 30 SOL virtual
    b.writeBigUInt64LE(793_100_000_000_000n, 24);
    b.writeBigUInt64LE(0n, 32);
    b.writeBigUInt64LE(1_000_000_000_000_000n, 40);
    b[48] = 0;
    const c = decodeCurve(b);
    expect(c.complete).toBe(false);
    expect(curvePrice(c)).toBeCloseTo(30 / 1_073_000_000, 12); // ~2.8e-8 SOL per token
    const tokens = quoteBuy(c, 1);
    expect(tokens).toBeGreaterThan(30_000_000);
    expect(tokens).toBeLessThan(1 / curvePrice(c)); // slippage: fewer than spot
    const back = quoteSell(c, tokens);
    expect(back).toBeGreaterThan(0.9);
    expect(back).toBeLessThan(1); // selling into the same curve returns a bit less
  });
  it("measures a SOL transfer from a parsed tx", () => {
    const from = Keypair.generate().publicKey,
      to = Keypair.generate().publicKey;
    const tx = {
      transaction: { message: { accountKeys: [{ pubkey: from }, { pubkey: to }] } },
      meta: { err: null, preBalances: [2_000_000_000, 500_000_000], postBalances: [1_989_995_000, 510_000_000] },
    } as unknown as ParsedTransactionWithMeta;
    expect(transferAmount(tx, from.toBase58(), to.toBase58())).toBeCloseTo(0.01, 9);
    expect(transferAmount(tx, to.toBase58(), from.toBase58())).toBe(0);
  });
});

describe("governance", () => {
  beforeEach(freshDb);
  it("opens a vote with a snapshot, accepts one signed ballot per wallet, tallies by weight", async () => {
    const a = seededAgent();
    const v = await openVote(a, "risk", a.ownerWallet, "too safe", NOW, 100);
    expect(v.status).toBe("live");
    expect(v.endsAt - v.startsAt).toBe(60_000);
    // owner (in snapshot) votes
    const owner = Keypair.generate();
    const a2 = { ...a, ownerWallet: owner.publicKey.toBase58() };
    const v2 = await openVote(a2, "takeProfit", a2.ownerWallet, undefined, NOW, 100);
    const sig = signMessage(ballotMessage(v2.id, "10x"), owner);
    const after = castBallot({ voteId: v2.id, option: "10x", wallet: a2.ownerWallet, signature: sig }, NOW + 1);
    expect(after.tallies["10x"]).toBe(Math.floor(a2.supply * 0.04));
    expect(() => castBallot({ voteId: v2.id, option: "2x", wallet: a2.ownerWallet, signature: signMessage(ballotMessage(v2.id, "2x"), owner) }, NOW + 2)).toThrow(/Already voted/);
    // a stranger with no snapshot weight
    const stranger = Keypair.generate();
    expect(() => castBallot({ voteId: v2.id, option: "2x", wallet: stranger.publicKey.toBase58(), signature: signMessage(ballotMessage(v2.id, "2x"), stranger) }, NOW + 3)).toThrow(/held none/);
    // paper mode: a demo wallet may self-declare a capped stake
    const demo = Keypair.generate();
    const r = castBallot({ voteId: v2.id, option: "2x", wallet: demo.publicKey.toBase58(), signature: signMessage(ballotMessage(v2.id, "2x"), demo), paperWeight: a2.supply * 0.5 }, NOW + 4);
    expect(r.tallies["2x"]).toBe(a2.supply * 0.01);
    // bad signature
    expect(() => castBallot({ voteId: v2.id, option: "5x", wallet: Keypair.generate().publicKey.toBase58(), signature: sig }, NOW + 5)).toThrow(/Bad signature/);
    // tally: 4% > 5% quorum? no → failed; with the demo ballot 5% → passes
    const t = tally(r, a2, NOW + 60_001, 250);
    expect(t.passed).toBe(true);
    expect(t.winner).toBe("10x");
    expect(t.rules?.takeProfit).toBe("10x");
    expect(t.vote.executedSlot).toBe(251);
    const low = tally({ ...r, tallies: { "2x": 10, "5x": 0, "10x": 0, never: 0 } }, a2, NOW + 60_001, 250);
    expect(low.passed).toBe(false);
    expect(low.vote.status).toBe("failed");
  });
  it("rejects votes after close", async () => {
    const a = seededAgent();
    const v = await openVote(a, "fire", a.ownerWallet, undefined, NOW, 1);
    expect(() => castBallot({ voteId: v.id, option: "fire", wallet: a.ownerWallet, signature: "x" }, NOW + 61_000)).toThrow(/closed/);
  });
});

describe("market + engine", () => {
  it("parses PumpPortal messages", () => {
    const launch = parseFeedMessage({ txType: "create", mint: "M1", symbol: "tps", name: "TPS", traderPublicKey: "dev", solAmount: 1, vSolInBondingCurve: 31, vTokensInBondingCurve: 1_040_000_000 }, 5);
    expect(launch).toMatchObject({ kind: "launch", mint: "M1", ticker: "TPS", devBuySol: 1, at: 5 });
    const buy = parseFeedMessage({ txType: "buy", mint: "M1", traderPublicKey: "w", solAmount: 0.5, tokenAmount: 1e7, vSolInBondingCurve: 31.5, vTokensInBondingCurve: 1_030_000_000 }, 6);
    expect(buy).toMatchObject({ kind: "trade", isBuy: true, sol: 0.5 });
    expect(parseFeedMessage({ message: "Successfully subscribed" })).toBeNull();
  });
  it("builds movers from the tape and the momentum engine buys them", () => {
    const m = new Market();
    const t0 = NOW;
    m.ingest({ kind: "launch", mint: "A", ticker: "AAA", name: "A", creator: "c", devBuySol: 1, price: 2.8e-8, at: t0 });
    for (let i = 0; i < 6; i++) m.ingest({ kind: "trade", mint: "A", trader: "w" + i, isBuy: true, sol: 0.5, tokens: 1e6, price: 2.8e-8 * (1 + i * 0.12), at: t0 + i * 10_000 });
    const snap = m.snapshot(t0 + 60_000, [], undefined);
    expect(snap.movers[0].mint).toBe("A");
    expect(snap.movers[0].move5m).toBeCloseTo(0.6, 5);
    const intents = decide(snap, { strategy: "momentum", risk: "staff", cadence: "never", takeProfit: "2x", salaryPct: 50 }, 100);
    expect(intents[0]).toMatchObject({ kind: "buy", mint: "A", rule: "strategy", sizeSol: 5 });
    // sniper sees the launch while it is young
    const young = m.snapshot(t0 + 2_000, [], undefined);
    expect(young.newLaunches[0]).toMatchObject({ mint: "A" });
    expect(decide(young, { strategy: "sniper", risk: "intern", cadence: "never", takeProfit: "2x", salaryPct: 50 }, 100)[0]).toMatchObject({ kind: "buy", rule: "strategy", sizeSol: 2 });
  });
  it("positions exit on take-profit and on risk stops", () => {
    const m = new Market();
    m.ingest({ kind: "trade", mint: "B", trader: "w", isBuy: true, sol: 1, tokens: 1, price: 2e-8, at: NOW });
    const pos = [{ mint: "B", ticker: "BBB", tokens: 1e8, costSol: 1 }]; // worth 2 SOL now → 2x
    const snap = m.snapshot(NOW + 1, pos);
    expect(snap.positions[0].mult).toBeCloseTo(2, 6);
    expect(decide(snap, { strategy: "momentum", risk: "staff", cadence: "never", takeProfit: "2x", salaryPct: 50 }, 10)[0]).toMatchObject({ kind: "sell", rule: "takeProfit" });
    m.ingest({ kind: "trade", mint: "B", trader: "w", isBuy: false, sol: 1, tokens: 1, price: 0.7e-8, at: NOW + 2 }); // 0.7 SOL → -30%
    const snap2 = m.snapshot(NOW + 3, pos);
    expect(decide(snap2, { strategy: "momentum", risk: "intern", cadence: "never", takeProfit: "2x", salaryPct: 50 }, 10)[0]).toMatchObject({ kind: "sell", rule: "risk" });
    expect(decide(snap2, { strategy: "momentum", risk: "degen", cadence: "never", takeProfit: "2x", salaryPct: 50 }, 10)).toHaveLength(0);
  });
  it("the synthetic feed emits launches and trades with the real shape", () => {
    const events: FeedEvent[] = [];
    const f = new SyntheticFeed((e) => events.push(e), 3);
    for (let i = 0; i < 50; i++) f.tick(NOW + i * 400);
    expect(events.some((e) => e.kind === "launch")).toBe(true);
    expect(events.some((e) => e.kind === "trade")).toBe(true);
    const t = events.find((e) => e.kind === "trade")!;
    expect(t.mint.endsWith("pump")).toBe(true);
  });
});

describe("paper execution", () => {
  beforeEach(freshDb);
  it("buys, tracks the position, and sells with the right PnL", async () => {
    const s0 = seededAgent();
    const a = { ...s0, rules: { ...s0.rules, takeProfit: "2x" as const }, vault: 10, pnl7d: 0, pnlHistory: [0], lossStreak: 0 };
    const m = new Market();
    m.ingest({ kind: "trade", mint: "C", ticker: "CCC", trader: "w", isBuy: true, sol: 1, tokens: 1, price: 1e-8, at: NOW });
    const buy = await execute(a, { kind: "buy", mint: "C", ticker: "CCC", sizeSol: 1, rule: "strategy", why: { move5m: 0.5 } }, m, NOW + 1);
    expect(buy!.trade).toMatchObject({ kind: "buy", amount: 1, ruleField: "strategy" });
    expect(buy!.patch.vault).toBeCloseTo(9, 6);
    const pos = getPositions(a.id);
    expect(pos).toHaveLength(1);
    expect(pos[0].costSol).toBe(1);
    expect(pos[0].tokens).toBeLessThan(1e8); // fee + slippage
    // price doubles → sell at take profit
    m.ingest({ kind: "trade", mint: "C", trader: "w", isBuy: true, sol: 1, tokens: 1, price: 2e-8, at: NOW + 2 });
    const a2 = { ...a, ...buy!.patch } as Agent;
    const sell = await execute(a2, { kind: "sell", mint: "C", ticker: "CCC", sizeSol: 2, rule: "takeProfit", why: { mult: 2 } }, m, NOW + 3);
    expect(sell!.trade.kind).toBe("sell");
    expect(sell!.trade.pnl!).toBeGreaterThan(0.8); // ~2x minus fees/slippage
    expect(sell!.trade.reason).toMatch(/Take-profit rule \(2x\)/);
    expect(getPositions(a.id)).toHaveLength(0);
    expect(sell!.patch.vault!).toBeGreaterThan(10.8);
  });
  it("launches a coin in paper mode and holds the dev buy", async () => {
    const a = { ...seededAgent(), vault: 5 };
    const m = new Market();
    const r = await execute(a, { kind: "launch", ticker: "MEMO", sizeSol: 0.5, rule: "cadence", why: { cadence: "1h" } }, m, NOW);
    expect(r!.trade).toMatchObject({ kind: "launch", coinTicker: "MEMO", ruleField: "cadence" });
    expect(r!.trade.coinCa.endsWith("pump")).toBe(true);
    expect(getPositions(a.id)[0].mint).toBe(r!.trade.coinCa);
  });
  it("template explanations name the rule", () => {
    const rules = { strategy: "sniper", risk: "degen", cadence: "never", takeProfit: "5x", salaryPct: 50 } as const;
    expect(templateReason({ kind: "buy", ticker: "X", sizeSol: 1, rule: "strategy", why: { ageBlocks: 2, devPct: 4 } }, rules)).toBe("Sniper rule: bought $X 2 blocks after launch, dev holds 4%. Size 100% of vault (Degen).");
    expect(templateReason({ kind: "sell", ticker: "X", sizeSol: 1, rule: "risk", why: { stop: -80 } }, rules)).toBe("Risk rule (Degen): stop-loss on $X at -80%.");
  });
});

describe("hire", () => {
  beforeEach(freshDb);
  it("validates and creates a paper agent with a wallet", async () => {
    const boss = Keypair.generate().publicKey.toBase58();
    const h = { name: "Gary from QA", ticker: "GARY", image: "🤖", rules: { strategy: "momentum" as const, risk: "staff" as const, cadence: "never" as const, takeProfit: "2x" as const, salaryPct: 50 }, devBuySol: 0.5, startingVaultSol: 2, wallet: boss };
    expect(() => validateHire({ ...h, ticker: "toolongticker" })).toThrow();
    expect(() => validateHire({ ...h, wallet: "nope" })).toThrow();
    const r = await hire(h, NOW);
    const w = loadWorld();
    expect(w.agents[r.id]).toMatchObject({ ticker: "GARY", ownerWallet: boss, vault: 2, status: "working" });
    expect(w.agents[r.id].wallet).toBe(r.agentWallet);
    expect(w.events[0].kind).toBe("hired");
  });
});

describe("worker", () => {
  beforeEach(freshDb);
  it("persists trades it makes and executes a passed vote", async () => {
    const { Worker } = await import("./worker");
    const w0 = createWorld(1337, NOW);
    persistDiff(emptyWorld(), w0, NOW);
    const seededTrades = loadWorld().trades.length;
    const clock = { v: NOW + 1000 };
    const w = new Worker(() => clock.v);
    // a busy tape so every strategy finds something
    const feed = new SyntheticFeed((e) => w.market.ingest(e), 11);
    for (let i = 0; i < 300; i++) feed.tick(NOW - 120_000 + i * 400);
    await w.tick();
    const after = loadWorld();
    expect(after.trades.length).toBeGreaterThan(seededTrades);
    expect(after.slot).toBeGreaterThan(w0.slot);
    expect(after.trades[0].reason).toMatch(/rule/i);
    // governance: open a vote; the paper crowd fills it; it closes and the rule changes
    const a = agentList(after).find((x) => x.status === "working")!;
    const v = await openVote(a, "risk", a.ownerWallet, undefined, clock.v, after.slot);
    clock.v = v.endsAt - 1;
    await w.tick();
    const mid = loadWorld().votes[v.id];
    expect(mid.voters.length).toBeGreaterThan(20);
    clock.v = v.endsAt + 1;
    await w.tick();
    const done = loadWorld();
    const dv = done.votes[v.id];
    expect(dv.status).toBe("passed");
    expect(done.agents[a.id].rules.risk).toBe(dv.winner);
    expect(done.agents[a.id].ruleSource.risk).toBe(v.id);
    expect(dv.executedSlot).toBe(dv.closeSlot! + 1);
    expect(done.events.some((e) => e.kind === "vote_pass" && e.voteId === v.id)).toBe(true);
    w.stop();
  });
});
