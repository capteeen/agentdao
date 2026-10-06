import { describe, expect, it } from "vitest";
import { agentList, applyTrade, autoFill, closeVote, createWorld, expectedEdge, favourite, getAgent, liveVotes, openVote, rateReport, stepObey, stepVotes, SIM } from "./sim";
import { mulberry32 } from "./util";
import type { RuleSet } from "./types";

const NOW = 1_700_000_000_000;
const rng = () => mulberry32(42);

function world() {
  return createWorld(1337, NOW);
}
function firstWorking(w: ReturnType<typeof world>) {
  return agentList(w).find((a) => a.status === "working" && !liveVotes(w).some((v) => v.agentId === a.id))!;
}

describe("createWorld", () => {
  it("is deterministic for a seed", () => {
    const a = createWorld(1337, NOW);
    const b = createWorld(1337, NOW);
    expect(Object.keys(a.agents)).toEqual(Object.keys(b.agents));
    expect(agentList(a).map((x) => x.ticker)).toEqual(agentList(b).map((x) => x.ticker));
  });
  it("seeds 25 employed agents, a graveyard and live votes", () => {
    const w = world();
    expect(agentList(w).filter((a) => a.status === "working" || a.status === "idle")).toHaveLength(SIM.AGENTS);
    expect(agentList(w).filter((a) => a.status === "fired" || a.status === "bankrupt").length).toBeGreaterThan(0);
    expect(liveVotes(w).length).toBeGreaterThanOrEqual(4);
  });
  it("every seeded trade cites a rule and the vote (or hire) that set it", () => {
    const w = world();
    for (const t of w.trades) {
      const a = getAgent(w, t.agentId)!;
      expect(t.ruleField).toBeTruthy();
      expect(t.voteId === "hire" || !!w.votes[t.voteId] || a.ruleSource[t.ruleField] === t.voteId).toBe(true);
    }
  });
});

describe("obedience: vote → rule → trade", () => {
  it("a passed vote rewrites the rule, links the vote, and executes one slot after close", () => {
    const w = world();
    const r = rng();
    const a = firstWorking(w);
    const v = openVote(w, r, a, "risk", NOW, "proposer");
    autoFill(w, r, v.id, 1); // meets quorum
    const winner = Object.entries(w.votes[v.id].tallies).sort((x, y) => y[1] - x[1])[0][0];
    const slotBefore = w.slot;
    closeVote(w, r, w.votes[v.id], NOW + SIM.VOTE_MS);
    const after = getAgent(w, a.id)!;
    expect(w.votes[v.id].status).toBe("passed");
    expect(w.votes[v.id].winner).toBe(winner);
    expect(after.rules.risk).toBe(winner);
    expect(after.ruleSource.risk).toBe(v.id);
    expect(after.votesExecuted).toBe(a.votesExecuted + 1);
    expect(w.votes[v.id].executedSlot! - w.votes[v.id].closeSlot!).toBe(1);
    expect(w.votes[v.id].closeSlot).toBe(slotBefore);
    expect(after.nextTradeAt).toBeGreaterThan(NOW + SIM.VOTE_MS);
    expect(after.nextTradeAt! - (NOW + SIM.VOTE_MS)).toBeLessThanOrEqual(SIM.OBEY_TRADE_MS);
  });

  it("the forced first trade after an order cites that vote", () => {
    const w = world();
    const r = rng();
    const a = firstWorking(w);
    const v = openVote(w, r, a, "strategy", NOW, "p");
    autoFill(w, r, v.id, 1);
    closeVote(w, r, w.votes[v.id], NOW + 1000);
    const due = getAgent(w, a.id)!.nextTradeAt!;
    stepObey(w, r, due - 1);
    expect(w.trades[0].agentId === a.id && w.trades[0].voteId === v.id).toBe(false); // not yet
    stepObey(w, r, due);
    const t = w.trades[0];
    expect(t.agentId).toBe(a.id);
    expect(t.ruleField).toBe("strategy");
    expect(t.voteId).toBe(v.id);
    expect(getAgent(w, a.id)!.nextTradeAt).toBeUndefined();
  });

  it("a vote under quorum changes nothing", () => {
    const w = world();
    const r = rng();
    const a = firstWorking(w);
    const v = openVote(w, r, a, "takeProfit", NOW, "p");
    // one tiny ballot
    w.votes[v.id].tallies[v.options[0]] = 10;
    closeVote(w, r, w.votes[v.id], NOW + SIM.VOTE_MS);
    expect(w.votes[v.id].status).toBe("failed");
    expect(getAgent(w, a.id)!.rules).toEqual(a.rules);
    expect(getAgent(w, a.id)!.nextTradeAt).toBeUndefined();
  });

  it("an order wakes an idle agent", () => {
    const w = world();
    const r = rng();
    const idle = agentList(w).find((a) => a.status === "idle")!;
    const v = openVote(w, r, idle, "cadence", NOW, "p");
    autoFill(w, r, v.id, 1);
    closeVote(w, r, w.votes[v.id], NOW + 1);
    expect(getAgent(w, idle.id)!.status).toBe("working");
  });
});

describe("firing", () => {
  it("liquidates the vault to holders and moves the agent to the graveyard", () => {
    const w = world();
    const r = rng();
    const a = firstWorking(w);
    const v = openVote(w, r, a, "fire", NOW, "p");
    w.votes[v.id].tallies = { fire: a.supply * 0.2, keep: a.supply * 0.01 };
    closeVote(w, r, w.votes[v.id], NOW + 1);
    const dead = getAgent(w, a.id)!;
    expect(dead.status).toBe("fired");
    expect(dead.vault).toBe(0);
    expect(dead.liquidated).toBeCloseTo(a.vault, 3);
    expect(dead.feesPaidToHolders).toBeCloseTo(a.feesPaidToHolders + a.vault, 3);
    expect(dead.causeOfDeath).toMatch(/^Fired by 9\d% of holders$/);
    expect(w.events.some((e) => e.kind === "payout" && e.agentId === a.id)).toBe(true);
    expect(w.reports[0].agentId).toBe(a.id);
  });
  it("keep wins → still employed", () => {
    const w = world();
    const r = rng();
    const a = firstWorking(w);
    const v = openVote(w, r, a, "fire", NOW, "p");
    w.votes[v.id].tallies = { fire: a.supply * 0.01, keep: a.supply * 0.2 };
    closeVote(w, r, w.votes[v.id], NOW + 1);
    expect(getAgent(w, a.id)!.status).toBe("working");
  });
});

describe("economics follow the rules", () => {
  it("Intern 2x has a better edge than Degen never", () => {
    const base: RuleSet = { strategy: "momentum", cadence: "never", takeProfit: "2x", salaryPct: 50, risk: "intern" };
    expect(expectedEdge(base)).toBeGreaterThan(expectedEdge({ ...base, risk: "degen", takeProfit: "never" }));
  });
  it("Degen trades have far higher variance than Intern trades", () => {
    const w = world();
    const r = rng();
    const a = firstWorking(w);
    const sample = (risk: RuleSet["risk"]) => {
      const pnls: number[] = [];
      const agent = { ...a, vault: 100, rules: { ...a.rules, risk, takeProfit: "never" as const } };
      for (let i = 0; i < 300; i++) {
        const res = applyTrade(w, r, agent, NOW + i);
        if (res?.pnl !== undefined) pnls.push(res.pnl);
      }
      const m = pnls.reduce((s, x) => s + x, 0) / pnls.length;
      return Math.sqrt(pnls.reduce((s, x) => s + (x - m) ** 2, 0) / pnls.length);
    };
    expect(sample("degen")).toBeGreaterThan(sample("intern") * 5);
  });
  it("the crowd fires losers and keeps winners", () => {
    const w = world();
    const r = rng();
    const a = firstWorking(w);
    const v = openVote(w, r, a, "fire", NOW, "p");
    expect(favourite(v, { ...a, vault: 10, pnl7d: -5, lossStreak: 4 })).toBe("fire");
    expect(favourite(v, { ...a, vault: 10, pnl7d: 5, lossStreak: 0 })).toBe("keep");
    const rv = openVote(w, r, a, "risk", NOW, "q");
    expect(favourite(rv, { ...a, vault: 10, pnl7d: -5, lossStreak: 4, rules: { ...a.rules, risk: "degen" } })).not.toBe("degen");
  });
});

describe("misc", () => {
  it("stepVotes closes expired votes", () => {
    const w = world();
    const r = rng();
    const n = liveVotes(w).length;
    stepVotes(w, r, NOW + 10 * 60_000);
    expect(liveVotes(w)).toHaveLength(0);
    expect(Object.values(w.votes).filter((v) => v.status !== "live").length).toBeGreaterThanOrEqual(n);
  });
  it("rating a report card counts the holder", () => {
    const w = world();
    const rep = w.reports[0];
    rateReport(w, rep.id, true);
    const after = w.reports.find((x) => x.id === rep.id)!;
    expect(after.raters).toBe(rep.raters + 1);
    expect(after.up).toBe(rep.up + 1);
  });
});
