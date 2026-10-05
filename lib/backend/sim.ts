"use client";

import type { BossBackend, HireInput } from "./types";
import { mutate, useBoss } from "../store";
import { closeVote, createWorld, getAgent, hireAgent, openRandomVote, openVote, SIM, stepReports, stepTrade, stepVotes } from "../sim";
import { fakeWallet, hashStr, mulberry32, range } from "../util";
import type { Agent } from "../types";

const rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);

/** Mock holdings: a wallet "holds" ~1/3 of agents, deterministic per pubkey. */
export function mockHoldingFor(wallet: string, a: Agent): number {
  if (a.ownerWallet === wallet) return Math.floor(a.supply * 0.04);
  const h = hashStr(wallet + a.id);
  if (h % 3 !== 0) return 0;
  return Math.floor(a.supply * (0.001 + ((h >>> 8) % 1000) / 1000 * 0.03));
}

export const simBackend: BossBackend = {
  name: "sim",

  start() {
    if (!useBoss.getState().ready) {
      const now = Date.now();
      useBoss.setState({ ...createWorld(1337, now), ready: true, backend: "sim" });
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    let alive = true;

    // trades every 3-8s
    const tradeLoop = () => {
      if (!alive) return;
      mutate((w) => stepTrade(w, rng, Date.now()));
      timers.push(setTimeout(tradeLoop, range(rng, SIM.TRADE_MIN_MS, SIM.TRADE_MAX_MS)));
    };
    timers.push(setTimeout(tradeLoop, 1500));

    // 1s heartbeat: slots advance, tallies fill, votes close
    timers.push(
      setInterval(() => {
        mutate((w) => {
          w.slot += Math.round(1000 / SIM.SLOT_MS);
          stepVotes(w, rng, Date.now());
        });
      }, 1000),
    );

    timers.push(setInterval(() => mutate((w) => openRandomVote(w, rng, Date.now())), SIM.VOTE_EVERY_MS));
    timers.push(setInterval(() => mutate((w) => openRandomVote(w, rng, Date.now(), "fire")), SIM.FIRE_EVERY_MS));
    timers.push(
      setInterval(() => {
        mutate((w) => stepReports(w, rng, Date.now()));
        useBoss.setState((s) => ({ bell: s.bell + 1 }));
      }, SIM.REPORT_EVERY_MS),
    );

    // Keep the floor staffed: after a firing, HR hires a replacement.
    timers.push(
      setInterval(() => {
        const s = useBoss.getState();
        const employed = s.agents.filter((a) => a.status === "working" || a.status === "idle").length;
        const lastFire = Math.max(0, ...s.agents.map((a) => a.firedAt ?? 0));
        if (employed < SIM.AGENTS && Date.now() - lastFire > 20_000) mutate((w) => hireAgent(w, rng, Date.now(), {}));
      }, 5000),
    );

    return () => {
      alive = false;
      timers.forEach((t) => clearTimeout(t));
    };
  },

  async holdings(wallet) {
    const s = useBoss.getState();
    return Object.fromEntries(s.agents.map((a) => [a.id, mockHoldingFor(wallet, a)]).filter(([, n]) => (n as number) > 0));
  },

  async vote(voteId, option, wallet) {
    const s = useBoss.getState();
    const v = s.votes.find((x) => x.id === voteId);
    if (!v || v.status !== "live") throw new Error("Vote is closed");
    if (v.voters.some((x) => x.wallet === wallet)) throw new Error("Already voted");
    const a = s.agents.find((x) => x.id === v.agentId)!;
    const weight = s.holdings[a.id] ?? mockHoldingFor(wallet, a);
    if (!weight) throw new Error(`You hold no $${a.ticker}. Buy some to get a vote.`);
    mutate((w) => {
      w.votes = w.votes.map((x) =>
        x.id === voteId
          ? { ...x, tallies: { ...x.tallies, [option]: (x.tallies[option] ?? 0) + weight }, voters: [{ wallet, option, weight, at: Date.now() }, ...x.voters] }
          : x,
      );
    });
    useBoss.setState((st) => ({ myVotes: { ...st.myVotes, [voteId]: option } }));
  },

  async propose(agentId, field, wallet, reason) {
    await new Promise((r) => setTimeout(r, 600)); // "signing"
    let id = "";
    mutate((w) => {
      const a = getAgent(w, agentId);
      if (!a || (a.status !== "working" && a.status !== "idle")) throw new Error("Agent is not employed");
      if (w.votes.some((v) => v.agentId === agentId && v.field === field && v.status === "live")) throw new Error("A vote on that is already live");
      const v = openVote(w, rng, a, field, Date.now(), wallet);
      v.reason = reason;
      id = v.id;
      w.votes = w.votes.map((x) => (x.id === v.id ? { ...v } : x));
      // proposal fee goes to the agent's vault
      w.agents = w.agents.map((x) => (x.id === agentId ? { ...x, vault: +(x.vault + SIM.PROPOSAL_FEE).toFixed(3) } : x));
    });
    return id;
  },

  async hire(input: HireInput, wallet) {
    await new Promise((r) => setTimeout(r, 1200)); // mocked pump.fun create + dev buy
    let id = "";
    mutate((w) => {
      const a = hireAgent(w, rng, Date.now(), {
        name: input.name,
        ticker: input.ticker.toUpperCase(),
        image: input.image,
        rules: input.rules,
        vault: input.startingVaultSol,
        ownerWallet: wallet,
        holders: 1,
        wallet: fakeWallet(rng),
      });
      id = a.id;
    });
    const s = useBoss.getState();
    useBoss.setState({ holdings: { ...s.holdings, [id]: Math.floor(1_000_000_000 * Math.min(0.1, 0.03 + input.devBuySol * 0.01)) } });
    return id;
  },
};

// Exposed for dev tools / tests: force-close a vote now.
export function debugCloseVote(id: string) {
  mutate((w) => {
    const v = w.votes.find((x) => x.id === id);
    if (v) closeVote(w, rng, v, Date.now());
  });
}
