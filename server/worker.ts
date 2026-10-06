// The BOSS worker. One process, one loop:
//   every tick:   advance slot · close due votes · obey fresh orders · evaluate
//                 rule engines against the market · cadence launches · bankruptcy
//   periodic:     creator-fee claims + holder payouts · daily report cards · gossip
// State lives in SQLite; the Next.js API serves it. Run with `npm run worker`.

import type { Agent, BossEvent, RuleField, Trade, Vote } from "../lib/types";
import { decide, type Intent } from "../lib/phase2/engine";
import { CADENCE_DESC, LABEL } from "../lib/rules";
import { agentList, employed, favourite, liveVotes, reportFor, stepGossip, type World } from "../lib/sim";
import { fakeMint, mulberry32, pick, range } from "../lib/util";
import { assertLiveConfig, CFG } from "./config";
import { allPositions, getKv, getSnapshot, hasBallot, loadWorld, openDb, persistDiff, saveBallot, savePayout, setKv } from "./db";
import { execute, liquidateAll } from "./executor";
import { Market, SyntheticFeed } from "./market";
import { passText, tally } from "./governance";
import { PumpFeed } from "./pumpportal";
import { connection, solBalance } from "./solana";
import { distribute, claimFees } from "./payouts";

const rng = mulberry32((Date.now() ^ 0xb055) >>> 0);
const nid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const LAUNCH_NAMES = ["TPSREPORT", "STAPLER", "SYNERGY", "CUBICLE", "MONDAY", "OVERTIME", "PAYDAY", "KPI", "MEMO", "BOARDROOM", "WATERCOOLER", "PROMO", "LAYOFF", "BONUS", "FRIDAY", "COFFEE", "REORG", "Q4", "PTO"];
const CADENCE_MS: Record<string, number> = { never: Infinity, daily: 86_400_000, "6h": 6 * 3_600_000, "1h": 3_600_000 };

export class Worker {
  market = new Market();
  world: World;
  feed: { start(): void; stop(): void; watchMint?(m: string): void; watchWallet?(w: string): void };
  lastEval = new Map<string, number>();
  lastLaunch = new Map<string, number>();
  busy = new Set<string>();
  timer: ReturnType<typeof setInterval> | null = null;
  constructor(public now: () => number = Date.now) {
    openDb();
    assertLiveConfig();
    this.world = loadWorld();
    const onEvent = (e: Parameters<Market["ingest"]>[0]) => this.market.ingest(e);
    this.feed = CFG.market === "synthetic" ? new SyntheticFeed(onEvent, 7, agentList(this.world).map((a) => a.rules.copyWallet ?? "").filter(Boolean)) : new PumpFeed(onEvent);
    // paper mode: creator fees accrue when someone buys an agent's launch
    this.market.onTrade((t, c) => {
      if (!t.isBuy || CFG.mode === "live") return;
      const a = agentList(this.world).find((x) => x.wallet === c.creator && employed(x));
      if (!a) return;
      const fee = t.sol * CFG.creatorFeeRate;
      this.patch(a.id, (x) => ({ feesEarned: +(x.feesEarned + fee).toFixed(6), feesPaidToHolders: +(x.feesPaidToHolders + fee * (1 - x.rules.salaryPct / 100)).toFixed(6), vault: +(x.vault + fee * (x.rules.salaryPct / 100)).toFixed(6) }));
    });
  }

  // ---------------------------------------------------------------- world helpers (immutable updates, persisted by diff)

  patch(id: string, fn: (a: Agent) => Partial<Agent>) {
    const a = this.world.agents[id];
    if (!a) return;
    this.world.agents = { ...this.world.agents, [id]: { ...a, ...fn(a) } };
  }
  setVote(v: Vote) {
    this.world.votes = { ...this.world.votes, [v.id]: v };
  }
  event(e: Omit<BossEvent, "id">) {
    this.world.events = [{ ...e, id: nid("e") }, ...this.world.events].slice(0, 400);
  }
  trade(t: Omit<Trade, "id">) {
    const full = { ...t, id: nid("t") };
    this.world.trades = [full, ...this.world.trades].slice(0, 3000);
    const a = this.world.agents[t.agentId];
    if (a) this.event({ kind: t.kind === "launch" ? "launch" : "trade", agentId: a.id, text: t.kind === "launch" ? `$${a.ticker} launched $${t.coinTicker} on pump.fun. ${t.ruleApplied}.` : t.kind === "buy" ? `$${a.ticker} bought ${t.amount.toFixed(2)} SOL of $${t.coinTicker}. ${t.ruleApplied}.` : `$${a.ticker} sold $${t.coinTicker} for ${t.pnl! >= 0 ? "+" : ""}${t.pnl!.toFixed(2)} SOL. ${t.ruleApplied}.`, at: t.at });
    return full;
  }

  /** Re-read agents/votes the API may have changed (hire, propose, vote) and merge our in-memory logs. */
  refresh() {
    const fresh = loadWorld({ trades: 0, events: 0, reports: 0 });
    this.world = { ...this.world, agents: fresh.agents, votes: fresh.votes, nextAgentNo: fresh.nextAgentNo };
  }

  // ---------------------------------------------------------------- lifecycle

  start() {
    this.feed.start();
    for (const p of allPositions()) this.feed.watchMint?.(p.mint);
    for (const a of agentList(this.world)) if (a.rules.copyWallet) this.feed.watchWallet?.(a.rules.copyWallet);
    this.timer = setInterval(() => this.tick().catch((e) => console.error("tick", e)), CFG.tickMs);
    console.log(`[boss] worker up · mode=${CFG.mode} market=${CFG.market} agents=${agentList(this.world).length}`);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.feed.stop();
  }

  async tick() {
    const now = this.now();
    this.refresh();
    const prev = this.world;
    this.world = { ...prev }; // field replacements below must not touch `prev`, or persistDiff sees nothing
    await this.advanceSlot();
    this.paperCrowd(now);
    await this.closeDueVotes(now);
    await this.obey(now);
    await this.evaluate(now);
    await this.cadence(now);
    await this.periodic(now);
    this.market.prune(now, new Set(allPositions().map((p) => p.mint)));
    persistDiff(prev, this.world, now);
  }

  async advanceSlot() {
    if (CFG.mode === "live" || CFG.market === "pumpportal") {
      try {
        this.world.slot = await connection().getSlot("confirmed");
        return;
      } catch {}
    }
    this.world.slot += Math.round(CFG.tickMs / 400);
  }

  // ---------------------------------------------------------------- governance

  async closeDueVotes(now: number) {
    for (const v of liveVotes(this.world)) {
      if (now < v.endsAt) continue;
      const a = this.world.agents[v.agentId];
      if (!a) continue;
      const out = tally(v, a, now, this.world.slot);
      this.setVote(out.vote);
      if (!out.passed) {
        this.event({ kind: "vote_fail", agentId: a.id, text: `Vote on $${a.ticker} ${v.field} missed quorum. No change.`, at: now, voteId: v.id });
        continue;
      }
      if (v.field === "fire") {
        if (out.winner === "fire") await this.fire(a, out.vote, now);
        else this.patch(a.id, (x) => ({ lastOrderAt: now, lastOrderVote: v.id, votesExecuted: x.votesExecuted + 1 }));
      } else if (v.field === "raise") {
        // A raise is a request to the owner: fees stay in the vault until +N SOL accrues.
        this.patch(a.id, (x) => ({ lastOrderAt: now, lastOrderVote: v.id, votesExecuted: x.votesExecuted + 1 }));
        this.event({ kind: "vote_pass", agentId: a.id, text: `${passText(a, out.vote)} Owner should top up ${a.wallet.slice(0, 6)}… by ${out.winner} SOL.`, at: now, voteId: v.id });
        continue;
      } else {
        this.patch(a.id, (x) => ({
          rules: out.rules!,
          ruleSource: { ...x.ruleSource, [out.field!]: v.id },
          status: "working",
          lastOrderAt: now,
          lastOrderVote: v.id,
          nextTradeAt: now + CFG.obeyTradeMs,
          votesExecuted: x.votesExecuted + 1,
          lossStreak: out.field === "risk" ? 0 : x.lossStreak,
        }));
        if (out.field === "strategy" && out.rules!.strategy === "copytrade" && out.rules!.copyWallet) this.feed.watchWallet?.(out.rules!.copyWallet);
      }
      this.event({ kind: "vote_pass", agentId: a.id, text: passText(a, out.vote), at: now, voteId: v.id });
    }
  }

  /**
   * Paper mode only: the synthetic holders in each vote's snapshot cast ballots
   * over the vote's life, leaning the way the crowd in lib/sim does (losers get
   * fired, winners get raises). Real wallets' ballots are never touched.
   */
  paperCrowd(now: number) {
    if (CFG.mode !== "paper") return;
    for (const v of liveVotes(this.world)) {
      const a = this.world.agents[v.agentId];
      const snap = getSnapshot(v.id);
      if (!a || !snap) continue;
      const synthetic = Object.entries(snap.balances).filter(([w]) => w.startsWith("paper"));
      if (!synthetic.length) continue;
      const progress = (now - v.startsAt) / (v.endsAt - v.startsAt);
      const shouldHave = Math.floor(progress * synthetic.length);
      const have = v.voters.filter((x) => x.wallet.startsWith("paper")).length;
      if (have >= shouldHave) continue;
      const fav = favourite(v, a);
      let nv = v;
      for (const [wallet, weight] of synthetic.slice(have, shouldHave)) {
        if (hasBallot(v.id, wallet)) continue;
        const option = rng() < 0.65 ? fav : pick(rng, v.options);
        saveBallot({ voteId: v.id, wallet, option, weight, signature: "paper", at: now });
        nv = { ...nv, tallies: { ...nv.tallies, [option]: (nv.tallies[option] ?? 0) + weight }, voters: [{ wallet, option, weight, at: now }, ...nv.voters].slice(0, 500) };
      }
      if (nv !== v) this.setVote(nv);
    }
  }

  async fire(a: Agent, v: Vote, now: number) {
    const { sol, trades } = await liquidateAll(a, this.market, now);
    for (const t of trades) this.trade(t);
    const vault = +(a.vault + sol).toFixed(6);
    const pct = Math.round((v.tallies.fire / Math.max(1, Object.values(v.tallies).reduce((s, x) => s + x, 0))) * 100);
    this.patch(a.id, (x) => ({ status: "fired", firedAt: now, firedBy: pct, causeOfDeath: `Fired by ${pct}% of holders`, vault: 0, liquidated: vault, feesPaidToHolders: +(x.feesPaidToHolders + vault).toFixed(6), lastOrderAt: now, lastOrderVote: v.id, votesExecuted: x.votesExecuted + 1 }));
    this.event({ kind: "fired", agentId: a.id, text: `${passText(a, v)} ${vault.toFixed(2)} SOL vault liquidated pro-rata to holders.`, at: now, voteId: v.id });
    const paid = await distribute(a, vault, "liquidation", v.id, now);
    this.event({ kind: "payout", agentId: a.id, text: `💸 ${paid.total.toFixed(2)} SOL from $${a.ticker}'s vault paid out to ${paid.count} holders.`, at: now + 1, voteId: v.id });
    this.world.reports = [reportFor(this.world, rng, this.world.agents[a.id], now), ...this.world.reports].slice(0, 600);
  }

  // ---------------------------------------------------------------- execution

  /** Agents with a fresh order trade under it first; the engine is asked with `prefer`. */
  async obey(now: number) {
    for (const a of agentList(this.world)) {
      if (a.status !== "working" || !a.nextTradeAt || now < a.nextTradeAt || this.busy.has(a.id)) continue;
      const field = (Object.entries(a.ruleSource).find(([, src]) => src === a.lastOrderVote)?.[0] as RuleField | undefined) ?? "strategy";
      await this.runEngine(a, now, field);
      // whether or not the market offered a matching trade, the order has been obeyed (rules are in force)
      this.patch(a.id, () => ({ nextTradeAt: undefined }));
    }
  }

  async evaluate(now: number) {
    for (const a of agentList(this.world)) {
      if (a.status !== "working" || this.busy.has(a.id)) continue;
      const last = this.lastEval.get(a.id) ?? 0;
      if (now - last < CFG.evalEveryMs) continue;
      this.lastEval.set(a.id, now);
      await this.runEngine(a, now);
    }
  }

  async runEngine(a0: Agent, now: number, prefer?: RuleField) {
    const a = this.world.agents[a0.id];
    const positions = allPositions().filter((p) => p.agentId === a.id);
    const m = this.market.snapshot(now, positions, a.rules.copyWallet);
    let intents = decide(m, a.rules, a.vault);
    if (prefer === "strategy" || prefer === "risk") intents = intents.filter((i) => i.rule !== "takeProfit" || prefer !== "risk");
    // one open position per coin, at most 3 positions, don't buy what we hold
    const held = new Set(positions.map((p) => p.mint));
    intents = intents.filter((i) => i.kind !== "buy" || (!held.has(i.mint!) && positions.length < 3));
    for (const intent of intents.slice(0, 2)) await this.runIntent(a, intent, now);
  }

  async runIntent(a0: Agent, intent: Intent, now: number) {
    const a = this.world.agents[a0.id];
    if (!a || a.status !== "working") return;
    this.busy.add(a.id);
    try {
      const res = await execute(a, intent, this.market, now);
      if (!res) return;
      this.trade(res.trade);
      this.patch(a.id, () => res.patch);
      if (intent.mint) this.feed.watchMint?.(intent.mint);
      const after = this.world.agents[a.id];
      if (after.vault < CFG.minVaultSol && allPositions().filter((p) => p.agentId === a.id).length === 0) {
        this.patch(a.id, () => ({ status: "bankrupt", firedAt: now, causeOfDeath: `Went bankrupt on ${LABEL[after.rules.risk]} risk`, vault: 0, liquidated: 0 }));
        this.event({ kind: "fired", agentId: a.id, text: `$${a.ticker} went bankrupt. Desk cleared.`, at: now });
        this.world.reports = [reportFor(this.world, rng, this.world.agents[a.id], now), ...this.world.reports].slice(0, 600);
      }
    } catch (e) {
      console.error("execute", a.ticker, intent.kind, (e as Error).message);
    } finally {
      this.busy.delete(a.id);
    }
  }

  /** Launch cadence: fee-farmers (and anyone with a cadence) launch coins on schedule. */
  async cadence(now: number) {
    for (const a of agentList(this.world)) {
      if (a.status !== "working" || this.busy.has(a.id)) continue;
      const every = CADENCE_MS[a.rules.cadence];
      if (!isFinite(every)) continue;
      const last = this.lastLaunch.get(a.id) ?? getKv(`launch:${a.id}`, a.bornAt);
      if (now - last < every) continue;
      if (a.vault < 0.2) continue;
      this.lastLaunch.set(a.id, now);
      setKv(`launch:${a.id}`, now);
      const ticker = pick(rng, LAUNCH_NAMES);
      await this.runIntent(a, { kind: "launch", ticker, sizeSol: Math.min(a.vault * 0.1, 1.5), rule: "cadence", why: { cadence: a.rules.cadence, desc: CADENCE_DESC[a.rules.cadence] } }, now);
    }
  }

  // ---------------------------------------------------------------- periodic

  async periodic(now: number) {
    const lastFees = getKv("lastFees", 0);
    if (now - lastFees > CFG.feeClaimEveryMs) {
      setKv("lastFees", now);
      for (const a of agentList(this.world).filter(employed)) {
        try {
          const claimed = await claimFees(a, now);
          if (claimed > 0) {
            const toHolders = claimed * (1 - a.rules.salaryPct / 100);
            this.patch(a.id, (x) => ({ feesEarned: +(x.feesEarned + claimed).toFixed(6), feesPaidToHolders: +(x.feesPaidToHolders + toHolders).toFixed(6), vault: +(x.vault + claimed - toHolders).toFixed(6) }));
            const paid = await distribute(a, toHolders, "fees", undefined, now);
            this.event({ kind: "payout", agentId: a.id, text: `$${a.ticker} claimed ${claimed.toFixed(3)} SOL in creator fees: ${toHolders.toFixed(3)} to ${paid.count} holders, ${(claimed - toHolders).toFixed(3)} kept (salary ${a.rules.salaryPct}%).`, at: now });
          }
        } catch (e) {
          console.error("fees", a.ticker, (e as Error).message);
        }
      }
    }
    const lastReport = getKv("lastReport", 0);
    if (now - lastReport > CFG.reportEveryMs) {
      setKv("lastReport", now);
      const fresh = agentList(this.world)
        .filter((a) => a.status === "working")
        .map((a) => reportFor(this.world, rng, a, now));
      this.world.reports = [...fresh, ...this.world.reports].slice(0, 600);
      this.event({ kind: "report", agentId: fresh[0]?.agentId ?? "", text: `🔔 Performance reviews are in. ${fresh.length} report cards posted.`, at: now });
    }
    const lastGossip = getKv("lastGossip", 0);
    if (now - lastGossip > CFG.gossipEveryMs) {
      setKv("lastGossip", now);
      stepGossip(this.world, rng, now);
    }
    // live: reconcile vault with the on-chain balance every minute
    if (CFG.mode === "live") {
      const lastRecon = getKv("lastRecon", 0);
      if (now - lastRecon > 60_000) {
        setKv("lastRecon", now);
        for (const a of agentList(this.world).filter(employed)) {
          try {
            const bal = await solBalance(a.wallet);
            if (Math.abs(bal - a.vault) > 0.001) this.patch(a.id, () => ({ vault: +bal.toFixed(6) }));
          } catch {}
        }
      }
    }
    void savePayout;
    void fakeMint;
    void range;
  }
}

if (require.main === module) {
  const w = new Worker();
  w.start();
  const bye = () => {
    w.stop();
    process.exit(0);
  };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
}
