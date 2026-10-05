// Phase 1 MOCK SIMULATOR.
//
// Produces a fully self-consistent BOSS world in the browser: 25 agents with
// random rule sets, trades every 3-8s whose reasons are derived from the
// agent's rules, votes that open / fill / pass and rewrite the rule set,
// report cards, firings and bankruptcies.
//
// Everything here is pure data-in / data-out (World -> World) so the same code
// can drive tests or a server-side replay. lib/backend/sim.ts wires it to the
// Zustand store on timers; lib/backend/live.ts is the Phase 2 replacement.

import type { Agent, BossEvent, ReportCard, RuleField, RuleSet, Trade, Vote, VoteField } from "./types";
import { CADENCES, FIELD_LABEL, LABEL, optionLabel, optionsFor, RISK_PCT, RISKS, SALARIES, STRATEGIES, TAKE_PROFITS, voteHeadline } from "./rules";
import { b58, fakeMint, fakeSig, fakeWallet, irange, mulberry32, pick, range, type Rng } from "./util";

export interface World {
  agents: Agent[];
  votes: Vote[];
  trades: Trade[];
  events: BossEvent[];
  reports: ReportCard[];
  slot: number;
  seq: number; // id counter
  nextAgentNo: number;
}

/** Mock timings. Phase 2 uses the real ones (votes run 1h). */
export const SIM = {
  AGENTS: 25,
  VOTE_MS: 90_000, // mock vote length (real: 1h)
  REAL_VOTE_MS: 3_600_000,
  TRADE_MIN_MS: 3_000,
  TRADE_MAX_MS: 8_000,
  VOTE_EVERY_MS: 120_000,
  REPORT_EVERY_MS: 300_000, // "daily" report cards on a 5-min timer in mock
  FIRE_EVERY_MS: 600_000,
  QUORUM: 0.05,
  PROPOSAL_FEE: 0.01,
  MAX_TRADES: 3000,
  MAX_EVENTS: 400,
  SLOT_MS: 400,
};

const FIRST = ["Gary", "Brenda", "Kevin", "Deb", "Todd", "Sheila", "Chad", "Linda", "Rick", "Pam", "Stan", "Doug", "Karen", "Barry", "Gloria", "Phil", "Marge", "Dwight", "Tina", "Hank", "Beth", "Lyle", "Joan", "Ned", "Rhonda", "Walt", "Fran", "Earl", "Velma", "Clyde", "Norma", "Otis", "Peggy", "Cliff", "Dot", "Merv"];
const DEPT = ["Accounting", "Sales", "HR", "Legal", "IT", "Ops", "Compliance", "Payroll", "Marketing", "Facilities", "Risk", "Audit"];
const FACES = ["🧑‍💼", "👩‍💼", "👨‍💼", "🤖", "🦊", "🐸", "🐶", "🐱", "🐻", "🐵", "🦉", "🐷"];
const COINS = ["WIF", "BONK", "POPCAT", "MEW", "GOAT", "PNUT", "MOODENG", "CHILLGUY", "FWOG", "MICHI", "RETARDIO", "SIGMA", "GIGA", "LOCKIN", "SCF", "ZEREBRO", "AURA", "HOPPY", "PONKE", "SLERF", "BOME", "MYRO", "WEN", "TREMP", "SPX", "USA", "KITTY", "DADDY", "CHONK", "STAPLER", "MEMO", "TPS", "SYNERGY", "KPI", "OOO"];
const LAUNCH_NAMES = ["TPSREPORT", "STAPLER", "SYNERGY", "CUBICLE", "MONDAY", "OVERTIME", "PAYDAY", "KPI", "MEMO", "BOARDROOM", "WATERCOOLER", "PROMO", "LAYOFF", "BONUS", "FRIDAY", "COFFEE", "REORG", "Q4", "PTO", "CCME"];

// ---------------------------------------------------------------- helpers

const nid = (w: World, p: string) => `${p}${(++w.seq).toString(36)}`;

export function patchAgent(w: World, id: string, patch: Partial<Agent> | ((a: Agent) => Partial<Agent>)) {
  w.agents = w.agents.map((a) => (a.id === id ? { ...a, ...(typeof patch === "function" ? patch(a) : patch) } : a));
}
function patchVote(w: World, id: string, patch: Partial<Vote>) {
  w.votes = w.votes.map((v) => (v.id === id ? { ...v, ...patch } : v));
}
export const getAgent = (w: World, id: string) => w.agents.find((a) => a.id === id);
export const ticker = (a: Pick<Agent, "ticker">) => `$${a.ticker}`;

function pushEvent(w: World, e: Omit<BossEvent, "id">) {
  w.events = [{ ...e, id: nid(w, "e") }, ...w.events].slice(0, SIM.MAX_EVENTS);
}

function randomRules(r: Rng): RuleSet {
  const strategy = pick(r, STRATEGIES);
  return {
    strategy,
    risk: pick(r, RISKS),
    cadence: strategy === "feefarmer" ? pick(r, ["daily", "6h", "1h"] as const) : pick(r, CADENCES),
    takeProfit: pick(r, TAKE_PROFITS),
    salaryPct: Number(pick(r, SALARIES)),
    copyWallet: strategy === "copytrade" ? fakeWallet(r) : undefined,
  };
}

function gradeFor(pnl: number, vault: number) {
  const roi = pnl / Math.max(vault, 1);
  if (roi > 0.6) return "A+";
  if (roi > 0.25) return "A";
  if (roi > 0.05) return "B";
  if (roi > -0.1) return "C";
  if (roi > -0.3) return "D";
  return "F";
}

// ---------------------------------------------------------------- creation

export function makeAgent(w: World, r: Rng, now: number, opts: Partial<Agent> & { rules?: RuleSet } = {}): Agent {
  const no = w.nextAgentNo++;
  const first = pick(r, FIRST);
  const name = opts.name ?? `${first} from ${pick(r, DEPT)}`;
  const tick = opts.ticker ?? (r() < 0.35 ? `BOSS_${no}` : first.toUpperCase().slice(0, 6) + (r() < 0.4 ? "AI" : ""));
  const rules = opts.rules ?? randomRules(r);
  const vault = opts.vault ?? +range(r, 2, 120).toFixed(2);
  const pnlHistory: number[] = [];
  let p = 0;
  for (let i = 0; i < 24; i++) {
    p += (r() - 0.46) * vault * 0.05;
    pnlHistory.push(+p.toFixed(3));
  }
  const feesEarned = opts.feesEarned ?? +range(r, 0.1, 40).toFixed(2);
  return {
    id: opts.id ?? `a${no}`,
    name,
    ticker: tick,
    image: opts.image ?? pick(r, FACES),
    coinCa: fakeMint(r),
    wallet: fakeWallet(r),
    vault,
    rules,
    ruleSource: { strategy: "hire", risk: "hire", cadence: "hire", takeProfit: "hire", salaryPct: "hire", copyWallet: "hire" },
    pnl7d: opts.pnl7d ?? +p.toFixed(2),
    pnlHistory,
    feesEarned,
    feesPaidToHolders: +(feesEarned * (1 - rules.salaryPct / 100)).toFixed(2),
    obedience: 100,
    votesExecuted: 0,
    holders: opts.holders ?? irange(r, 40, 2400),
    supply: 1_000_000_000,
    bornAt: opts.bornAt ?? now - range(r, 0.5, 40) * 86_400_000,
    status: "working",
    ownerWallet: opts.ownerWallet ?? fakeWallet(r),
    lossStreak: 0,
    seed: Math.floor(r() * 1e9),
    ...opts,
  } as Agent;
}

/** Deterministic initial world. Same seed => same agents (used by OG routes). */
export function createWorld(seed = 1337, now = Date.now()): World {
  const r = mulberry32(seed);
  const w: World = { agents: [], votes: [], trades: [], events: [], reports: [], slot: 312_000_000 + Math.floor((now / SIM.SLOT_MS) % 1e6), seq: 0, nextAgentNo: 1 };

  for (let i = 0; i < SIM.AGENTS; i++) w.agents.push(makeAgent(w, r, now));

  // Past votes: most agents got their current strategy / risk from a vote.
  for (const a of w.agents) {
    const nPast = irange(r, 1, 4);
    const fields: RuleField[] = ["strategy", "risk", "takeProfit", "cadence", "salaryPct"];
    for (let k = 0; k < nPast; k++) {
      const field = fields[k];
      const end = a.bornAt + ((k + 1) / (nPast + 1)) * (now - a.bornAt);
      const winner = String(a.rules[field]);
      const v = pastVote(w, r, a, field, winner, end);
      w.votes.push(v);
      a.ruleSource = { ...a.ruleSource, [field]: v.id };
      a.votesExecuted++;
    }
    // History of trades over the last day.
    const n = irange(r, 6, 14);
    for (let k = 0; k < n; k++) {
      const t = genTrade(w, r, a, now - range(r, 60_000, 86_400_000));
      if (t) w.trades.push(t.trade);
    }
  }
  w.trades.sort((x, y) => y.at - x.at);

  // Two agents start asleep: no active orders until the board votes.
  for (const a of [w.agents[5], w.agents[17]]) a.status = "idle";

  // The graveyard is never empty.
  for (let i = 0; i < 4; i++) {
    const a = makeAgent(w, r, now, { bornAt: now - range(r, 5, 30) * 86_400_000 });
    const firedAt = now - range(r, 0.2, 4) * 86_400_000;
    const bankrupt = i === 3;
    const pct = irange(r, 55, 94);
    Object.assign(a, {
      status: bankrupt ? "bankrupt" : "fired",
      firedAt,
      firedBy: bankrupt ? undefined : pct,
      causeOfDeath: bankrupt ? `Went bankrupt on ${LABEL[a.rules.risk]} risk` : `Fired by ${pct}% of holders`,
      vault: 0,
      pnl7d: -Math.abs(a.pnl7d) - range(r, 1, 20),
    });
    if (!bankrupt) {
      const v = pastVote(w, r, a, "fire", "fire", firedAt);
      v.tallies = { fire: pct, keep: 100 - pct };
      w.votes.push(v);
    }
    w.agents.push(a);
    w.reports.push(reportFor(w, r, a, firedAt - 60_000));
  }

  // Report cards for everyone (the "last review").
  for (const a of w.agents) if (a.status === "working") w.reports.push(reportFor(w, r, a, now - range(r, 30_000, 240_000)));

  // A few votes already live on first load, closing soon, so memos fly early.
  const live = w.agents.filter((a) => a.status === "working");
  const sleepy = w.agents.find((a) => a.status === "idle");
  const plan: { field: VoteField; endIn: number }[] = [
    { field: "risk", endIn: 14_000 },
    { field: "strategy", endIn: 42_000 },
    { field: "takeProfit", endIn: 70_000 },
    { field: "fire", endIn: 105_000 },
  ];
  plan.forEach((p, i) => {
    const a = live[(i * 7 + 3) % live.length];
    const v = openVote(w, r, a, p.field, now - (SIM.VOTE_MS - p.endIn), fakeWallet(r));
    v.endsAt = now + p.endIn;
    // Pre-fill tallies proportional to elapsed time.
    autoFill(w, r, v.id, 0.6);
  });
  // ...and one vote to wake a sleeping agent.
  if (sleepy) {
    const v = openVote(w, r, sleepy, "strategy", now - (SIM.VOTE_MS - 28_000), fakeWallet(r));
    v.endsAt = now + 28_000;
    autoFill(w, r, v.id, 0.6);
  }

  // Seed ticker with recent history.
  const recent = w.votes.filter((v) => v.status === "passed").sort((a, b) => b.endsAt - a.endsAt).slice(0, 8);
  for (const v of recent.reverse()) {
    const a = getAgent(w, v.agentId)!;
    pushEvent(w, { kind: v.field === "fire" ? "fired" : "vote_pass", agentId: a.id, text: passText(a, v), at: v.endsAt, voteId: v.id });
  }
  for (const t of w.trades.slice(0, 12).reverse()) {
    const a = getAgent(w, t.agentId)!;
    pushEvent(w, { kind: t.kind === "launch" ? "launch" : "trade", agentId: a.id, text: tradeText(a, t), at: t.at });
  }
  w.events.sort((x, y) => y.at - x.at);
  return w;
}

function pastVote(w: World, r: Rng, a: Agent, field: VoteField, winner: string, end: number): Vote {
  const options = optionsFor(field);
  const tallies: Record<string, number> = {};
  let total = 0;
  for (const o of options) {
    const t = Math.floor(range(r, 0.002, 0.04) * a.supply);
    tallies[o] = t;
    total += t;
  }
  tallies[winner] = Math.floor(total * range(r, 0.8, 2.5));
  return {
    id: nid(w, "v"),
    agentId: a.id,
    field,
    options,
    tallies,
    voters: [],
    proposer: fakeWallet(r),
    startsAt: end - SIM.REAL_VOTE_MS,
    endsAt: end,
    status: "passed",
    winner,
    executedAt: end + 400,
    executedSlot: w.slot - Math.floor((Date.now() - end) / SIM.SLOT_MS) + 1,
    txSig: fakeSig(r),
    snapshotSupply: a.supply,
  };
}

// ---------------------------------------------------------------- trades

export function tradeText(a: Agent, t: Trade) {
  if (t.kind === "launch") return `$${a.ticker} launched $${t.coinTicker} on pump.fun. ${t.ruleApplied}.`;
  if (t.kind === "buy") return `$${a.ticker} bought ${t.amount.toFixed(2)} SOL of $${t.coinTicker}. ${t.ruleApplied}.`;
  return `$${a.ticker} sold $${t.coinTicker} for ${t.pnl! >= 0 ? "+" : ""}${t.pnl!.toFixed(2)} SOL. ${t.ruleApplied}.`;
}

/** Generate one trade for an agent, strictly derived from its current rule set. */
export function genTrade(w: World, r: Rng, a: Agent, at: number): { trade: Trade; patch: Partial<Agent> } | null {
  const R = a.rules;
  const size = Math.max(0.01, a.vault * Math.min(RISK_PCT[R.risk], 0.9));
  const coin = pick(r, COINS);
  const ca = fakeMint(r);
  const roll = r();
  let trade: Omit<Trade, "id">;
  const src = (f: RuleField) => a.ruleSource[f] ?? "hire";

  const wantsLaunch = R.cadence !== "never" && roll < (R.strategy === "feefarmer" ? 0.45 : R.cadence === "1h" ? 0.2 : 0.08);
  if (wantsLaunch) {
    const name = pick(r, LAUNCH_NAMES);
    const cad = LABEL[R.cadence].toLowerCase();
    trade = {
      agentId: a.id,
      kind: "launch",
      coinCa: ca,
      coinTicker: name,
      amount: +Math.min(size, 1.5).toFixed(3),
      reason:
        R.strategy === "feefarmer"
          ? `Fee-farmer rule + ${cad} cadence: launched $${name}, dev-bought ${Math.min(size, 1.5).toFixed(2)} SOL, now farming creator fees.`
          : `Cadence rule (${cad}): launch slot came up, launched $${name}.`,
      ruleApplied: `Launch cadence: ${LABEL[R.cadence]}`,
      ruleField: "cadence",
      voteId: src("cadence"),
      at,
      txSig: fakeSig(r),
    };
    const fees = +range(r, 0.05, 2.5).toFixed(3);
    return {
      trade: { ...trade, id: nid(w, "t") },
      patch: {
        feesEarned: +(a.feesEarned + fees).toFixed(3),
        feesPaidToHolders: +(a.feesPaidToHolders + fees * (1 - R.salaryPct / 100)).toFixed(3),
        vault: +(a.vault + fees * (R.salaryPct / 100)).toFixed(3),
        lastAction: { kind: "launch", at },
      },
    };
  }

  if (roll < 0.55) {
    // BUY — reason comes from the strategy rule.
    let reason: string;
    switch (R.strategy) {
      case "sniper":
        reason = `Sniper rule: bought $${coin} ${irange(r, 1, 4)} blocks after launch, dev holds ${irange(r, 1, 9)}%.`;
        break;
      case "momentum":
        reason = `Momentum rule: bought $${coin} after ${irange(r, 25, 140)}% move in ${pick(r, [1, 5, 15])}m.`;
        break;
      case "feefarmer":
        reason = `Fee-farmer rule: bought back own launch $${coin} to support the curve.`;
        break;
      case "copytrade":
        reason = `Copy-trade rule: mirrored ${(R.copyWallet ?? b58(r, 44)).slice(0, 4)}… buying $${coin}.`;
        break;
    }
    reason += ` Size ${(RISK_PCT[R.risk] * 100).toFixed(0)}% of vault (${LABEL[R.risk]}).`;
    trade = {
      agentId: a.id,
      kind: "buy",
      coinCa: ca,
      coinTicker: coin,
      amount: +size.toFixed(3),
      reason,
      ruleApplied: `Strategy: ${LABEL[R.strategy]}`,
      ruleField: "strategy",
      voteId: src("strategy"),
      at,
      txSig: fakeSig(r),
    };
    return { trade: { ...trade, id: nid(w, "t") }, patch: { lastAction: { kind: "buy", at } } };
  }

  // SELL — take profit or risk stop.
  const tpMult = { "2x": 2, "5x": 5, "10x": 10, never: 0 }[R.takeProfit];
  const winP = { "2x": 0.5, "5x": 0.24, "10x": 0.12, never: 0.38 }[R.takeProfit] + (a.seed % 100) / 1000 - 0.05;
  const win = r() < winP;
  let pnl: number, reason: string, ruleApplied: string, field: RuleField;
  if (win) {
    const m = tpMult ? tpMult + range(r, 0, 0.4) : range(r, 1.2, 4);
    pnl = size * (m - 1) * 0.6;
    reason = tpMult
      ? `Take-profit rule (${R.takeProfit}): sold $${coin} at ${m.toFixed(1)}x.`
      : `Take-profit rule (never): held $${coin} until the curve stalled, exited at ${m.toFixed(1)}x.`;
    ruleApplied = `Take profit: ${LABEL[R.takeProfit]}`;
    field = "takeProfit";
  } else {
    const m = range(r, 0.15, 0.85);
    pnl = -size * (1 - m);
    reason = `Risk rule (${LABEL[R.risk]}): stop-loss on $${coin} at -${((1 - m) * 100).toFixed(0)}%.`;
    ruleApplied = `Risk: ${LABEL[R.risk]}`;
    field = "risk";
  }
  pnl = +pnl.toFixed(3);
  trade = {
    agentId: a.id,
    kind: "sell",
    coinCa: ca,
    coinTicker: coin,
    amount: +size.toFixed(3),
    pnl,
    reason,
    ruleApplied,
    ruleField: field,
    voteId: src(field),
    at,
    txSig: fakeSig(r),
  };
  const vault = +Math.max(0, a.vault + pnl).toFixed(3);
  const last = a.pnlHistory[a.pnlHistory.length - 1] ?? 0;
  return {
    trade: { ...trade, id: nid(w, "t") },
    patch: {
      vault,
      pnl7d: +(a.pnl7d + pnl).toFixed(3),
      pnlHistory: [...a.pnlHistory, +(last + pnl).toFixed(3)].slice(-60),
      lossStreak: pnl < 0 ? a.lossStreak + 1 : 0,
      lastAction: { kind: "sell", at },
    },
  };
}

export function stepTrade(w: World, r: Rng, now: number) {
  const working = w.agents.filter((a) => a.status === "working");
  if (!working.length) return;
  const a = pick(r, working);
  const res = genTrade(w, r, a, now);
  if (!res) return;
  w.trades = [res.trade, ...w.trades].slice(0, SIM.MAX_TRADES);
  patchAgent(w, a.id, res.patch);
  pushEvent(w, { kind: res.trade.kind === "launch" ? "launch" : "trade", agentId: a.id, text: tradeText(a, res.trade), at: now });
  const after = getAgent(w, a.id)!;
  if (after.vault < 0.05) {
    patchAgent(w, a.id, { status: "bankrupt", firedAt: now, causeOfDeath: `Went bankrupt on ${LABEL[after.rules.risk]} risk`, vault: 0 });
    pushEvent(w, { kind: "fired", agentId: a.id, text: `$${a.ticker} went bankrupt. Desk cleared.`, at: now });
    w.reports = [reportFor(w, r, getAgent(w, a.id)!, now), ...w.reports];
  }
}

// ---------------------------------------------------------------- votes

export function openVote(w: World, r: Rng, a: Agent, field: VoteField, now: number, proposer: string, durationMs = SIM.VOTE_MS): Vote {
  const v: Vote = {
    id: nid(w, "v"),
    agentId: a.id,
    field,
    options: optionsFor(field),
    tallies: Object.fromEntries(optionsFor(field).map((o) => [o, 0])),
    voters: [],
    proposer,
    startsAt: now,
    endsAt: now + durationMs,
    status: "live",
    snapshotSupply: a.supply,
  };
  w.votes = [v, ...w.votes];
  pushEvent(w, { kind: "vote_open", agentId: a.id, text: `New vote on $${a.ticker}: ${FIELD_LABEL[field]}. Closes in ${Math.round(durationMs / 60000) || 1}m.`, at: now, voteId: v.id });
  return v;
}

/** Simulated holders voting. `frac` = how much of the vote's eventual turnout to add. */
export function autoFill(w: World, r: Rng, voteId: string, frac: number) {
  const v = w.votes.find((x) => x.id === voteId);
  if (!v || v.status !== "live") return;
  const a = getAgent(w, v.agentId)!;
  // Each vote has a hidden favourite so tallies move like a real crowd.
  const fav = favourite(v, a);
  const tallies = { ...v.tallies };
  const voters = [...v.voters];
  const n = Math.max(1, Math.round(frac * 30));
  for (let i = 0; i < n; i++) {
    const opt = r() < 0.55 ? fav : pick(r, v.options);
    const weight = Math.floor(v.snapshotSupply * range(r, 0.0004, 0.0045));
    tallies[opt] = (tallies[opt] ?? 0) + weight;
    if (voters.length < 120) voters.push({ wallet: fakeWallet(r), option: opt, weight, at: Date.now() });
  }
  patchVote(w, v.id, { tallies, voters });
}

function favourite(v: Vote, a: Agent): string {
  const h = parseInt(v.id.slice(1), 36) + a.seed;
  if (v.field === "fire") return a.pnl7d < 0 || h % 4 !== 0 ? "fire" : "keep";
  const cur = v.field in a.rules ? String(a.rules[v.field as RuleField]) : "";
  const opts = v.options.filter((o) => o !== cur);
  return opts[h % opts.length] ?? v.options[0];
}

export function passText(a: Agent, v: Vote) {
  const total = Object.values(v.tallies).reduce((s, x) => s + x, 0) || 1;
  const pct = Math.round(((v.tallies[v.winner!] ?? 0) / total) * 100);
  if (v.field === "fire" && v.winner === "fire") return `Holders of $${a.ticker} voted to FIRE the agent (${pct}%). Box packed. Agent complied.`;
  return `Holders of $${a.ticker} ${voteHeadline(v.field, v.winner!)} (${pct}%). Agent complied.`;
}

export function closeVote(w: World, r: Rng, v: Vote, now: number) {
  const a = getAgent(w, v.agentId);
  if (!a) return;
  const total = Object.values(v.tallies).reduce((s, x) => s + x, 0);
  if (total < v.snapshotSupply * SIM.QUORUM || (a.status !== "working" && a.status !== "idle")) {
    patchVote(w, v.id, { status: "failed" });
    pushEvent(w, { kind: "vote_fail", agentId: a.id, text: `Vote on $${a.ticker} ${FIELD_LABEL[v.field].toLowerCase()} missed quorum. No change.`, at: now, voteId: v.id });
    return;
  }
  const winner = Object.entries(v.tallies).sort((x, y) => y[1] - x[1])[0][0];
  const slot = w.slot + 1; // executed in the very next block
  const done: Partial<Vote> = { status: "passed", winner, executedAt: now + SIM.SLOT_MS, executedSlot: slot, txSig: fakeSig(r) };
  patchVote(w, v.id, done);
  const nv = { ...v, ...done };

  if (v.field === "fire") {
    if (winner === "fire") {
      const pct = Math.round((v.tallies.fire / total) * 100);
      const liquidated = a.vault;
      patchAgent(w, a.id, {
        status: "fired",
        firedAt: now,
        firedBy: pct,
        causeOfDeath: `Fired by ${pct}% of holders`,
        vault: 0,
        feesPaidToHolders: +(a.feesPaidToHolders + liquidated).toFixed(3),
        lastOrderAt: now,
        votesExecuted: a.votesExecuted + 1,
      });
      pushEvent(w, { kind: "fired", agentId: a.id, text: `${passText(a, nv)} ${liquidated.toFixed(2)} SOL vault liquidated pro-rata to holders.`, at: now, voteId: v.id });
      w.reports = [reportFor(w, r, getAgent(w, a.id)!, now), ...w.reports];
      return;
    }
  } else if (v.field === "raise") {
    patchAgent(w, a.id, { vault: +(a.vault + Number(winner)).toFixed(3), lastOrderAt: now, votesExecuted: a.votesExecuted + 1 });
  } else {
    const field = v.field as RuleField;
    const value = field === "salaryPct" ? Number(winner) : winner;
    const rules = { ...a.rules, [field]: value } as RuleSet;
    if (field === "strategy" && winner === "copytrade" && !rules.copyWallet) rules.copyWallet = fakeWallet(r);
    // An order wakes a sleeping agent up.
    patchAgent(w, a.id, { rules, ruleSource: { ...a.ruleSource, [field]: v.id }, status: "working", lastOrderAt: now, votesExecuted: a.votesExecuted + 1, lossStreak: field === "risk" ? 0 : a.lossStreak });
  }
  pushEvent(w, { kind: "vote_pass", agentId: a.id, text: passText(a, nv), at: now, voteId: v.id });
}

export function stepVotes(w: World, r: Rng, now: number) {
  for (const v of w.votes) {
    if (v.status !== "live") continue;
    if (now >= v.endsAt) closeVote(w, r, v, now);
    else if (r() < 0.6) autoFill(w, r, v.id, 0.08);
  }
}

export function openRandomVote(w: World, r: Rng, now: number, field?: VoteField) {
  const working = w.agents.filter((a) => (a.status === "working" || (a.status === "idle" && field !== "fire")) && !w.votes.some((v) => v.agentId === a.id && v.status === "live"));
  if (!working.length) return;
  let a: Agent;
  if (field === "fire") a = [...working].sort((x, y) => x.pnl7d - y.pnl7d)[irange(r, 0, Math.min(4, working.length - 1))];
  else a = pick(r, working);
  const f = field ?? pick(r, ["strategy", "risk", "risk", "cadence", "takeProfit", "salaryPct", "raise"] as VoteField[]);
  openVote(w, r, a, f, now, fakeWallet(r));
}

// ---------------------------------------------------------------- reports / hiring

export function reportFor(w: World, r: Rng, a: Agent, at: number): ReportCard {
  const pnl = +(a.pnlHistory.length > 6 ? a.pnlHistory[a.pnlHistory.length - 1] - a.pnlHistory[a.pnlHistory.length - 7] : a.pnl7d / 7).toFixed(3);
  return {
    id: nid(w, "r"),
    agentId: a.id,
    at,
    pnl,
    obedience: a.obedience,
    feesPaid: +(a.feesPaidToHolders * range(r, 0.02, 0.12)).toFixed(3),
    trades: irange(r, 8, 140),
    raters: Math.max(3, Math.floor(a.holders * range(r, 0.05, 0.3))),
    grade: gradeFor(pnl * 7, a.vault),
  };
}

export function stepReports(w: World, r: Rng, now: number) {
  const fresh = w.agents.filter((a) => a.status === "working").map((a) => reportFor(w, r, a, now));
  w.reports = [...fresh, ...w.reports].slice(0, 600);
  pushEvent(w, { kind: "report", agentId: fresh[0]?.agentId ?? "", text: `🔔 Performance reviews are in. ${fresh.length} report cards posted.`, at: now });
}

export function hireAgent(w: World, r: Rng, now: number, opts: Partial<Agent> & { rules?: RuleSet }) {
  const a = makeAgent(w, r, now, { bornAt: now, pnl7d: 0, feesEarned: 0, holders: opts.holders ?? 1, ...opts });
  a.pnlHistory = [0];
  a.feesPaidToHolders = 0;
  w.agents = [...w.agents, a];
  pushEvent(w, { kind: "hired", agentId: a.id, text: `New hire: $${a.ticker} (${a.name}) joined the floor as a ${LABEL[a.rules.strategy]} on ${LABEL[a.rules.risk]} risk.`, at: now });
  return a;
}

export const describeVote = (v: Vote, a: Agent | undefined) =>
  `${a ? "$" + a.ticker : "?"}: ${FIELD_LABEL[v.field]} → ${v.options.map((o) => optionLabel(v.field, o)).join(" / ")}`;
