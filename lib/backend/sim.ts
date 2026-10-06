"use client";

import type { BossBackend, HireInput } from "./types";
import { mutate, pickWorld, useBoss } from "../store";
import { agentList, closeVote, createWorld, getAgent, hireAgent, liveVotes, openRandomVote, openVote, patchAgent, patchVote, rateReport, SIM, stepGossip, stepObey, stepReports, stepTrade, stepVotes, type World } from "../sim";
import { fakeWallet, hashStr, mulberry32, range } from "../util";
import type { Agent } from "../types";
import { watchEvents } from "./watch";

const rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);

const SAVE_KEY = "boss:world:v2";
const SAVE_MAX_AGE = 60 * 60 * 1000; // an hour away and HR resets the floor

/** Mock holdings: a wallet "holds" ~1/3 of agents, deterministic per pubkey. */
export function mockHoldingFor(wallet: string, a: Agent): number {
  if (a.ownerWallet === wallet) return Math.floor(a.supply * 0.04);
  const h = hashStr(wallet + a.id);
  if (h % 3 !== 0) return 0;
  return Math.floor(a.supply * (0.001 + (((h >>> 8) % 1000) / 1000) * 0.03));
}

function loadWorld(now: number): World | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const { savedAt, world } = JSON.parse(raw) as { savedAt: number; world: World };
    if (!world?.agents || now - savedAt > SAVE_MAX_AGE) return null;
    // Votes keep their deadlines; anything that should have closed while the tab
    // was away closes on the first heartbeat.
    return world;
  } catch {
    return null;
  }
}

function saveWorld() {
  try {
    const s = useBoss.getState();
    if (!s.ready) return;
    const w = pickWorld(s);
    localStorage.setItem(SAVE_KEY, JSON.stringify({ savedAt: Date.now(), world: { ...w, trades: w.trades.slice(0, 600), events: w.events.slice(0, 150) } }));
  } catch {}
}

export const simBackend: BossBackend = {
  name: "sim",

  start() {
    if (!useBoss.getState().ready) {
      const now = Date.now();
      const world = loadWorld(now) ?? createWorld(1337, now);
      useBoss.setState({ ...world, ready: true, backend: "sim" });
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    let alive = true;
    const unsub = watchEvents();

    // trades every 3-8s
    const tradeLoop = () => {
      if (!alive) return;
      mutate((w) => stepTrade(w, rng, Date.now()));
      timers.push(setTimeout(tradeLoop, range(rng, SIM.TRADE_MIN_MS, SIM.TRADE_MAX_MS)));
    };
    timers.push(setTimeout(tradeLoop, 1500));

    // 400ms heartbeat (one slot): slots advance, tallies fill, votes close, orders are obeyed
    let tick = 0;
    timers.push(
      setInterval(() => {
        tick++;
        mutate((w) => {
          w.slot += 1;
          stepObey(w, rng, Date.now());
          if (tick % 2 === 0) stepVotes(w, rng, Date.now());
        });
      }, SIM.SLOT_MS),
    );

    timers.push(setInterval(() => mutate((w) => openRandomVote(w, rng, Date.now())), SIM.VOTE_EVERY_MS));
    timers.push(setInterval(() => mutate((w) => openRandomVote(w, rng, Date.now(), "fire")), SIM.FIRE_EVERY_MS));
    timers.push(setInterval(() => mutate((w) => stepGossip(w, rng, Date.now())), SIM.GOSSIP_EVERY_MS));
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
        const all = agentList(s);
        const employed = all.filter((a) => a.status === "working" || a.status === "idle").length;
        const lastFire = Math.max(0, ...all.map((a) => a.firedAt ?? 0));
        if (employed < SIM.AGENTS && Date.now() - lastFire > 20_000) mutate((w) => hireAgent(w, rng, Date.now(), {}));
      }, 5000),
    );

    timers.push(setInterval(saveWorld, 5000));
    const onHide = () => document.visibilityState === "hidden" && saveWorld();
    document.addEventListener("visibilitychange", onHide);

    return () => {
      alive = false;
      unsub();
      timers.forEach((t) => clearTimeout(t));
      document.removeEventListener("visibilitychange", onHide);
      saveWorld();
    };
  },

  async holdings(wallet) {
    const s = useBoss.getState();
    return Object.fromEntries(
      agentList(s)
        .map((a) => [a.id, mockHoldingFor(wallet, a)] as const)
        .filter(([, n]) => n > 0),
    );
  },

  async vote(voteId, option, wallet) {
    const s = useBoss.getState();
    const v = s.votes[voteId];
    if (!v || v.status !== "live") throw new Error("Vote is closed");
    if (v.voters.some((x) => x.wallet === wallet)) throw new Error("Already voted");
    const a = s.agents[v.agentId];
    const weight = s.holdings[a.id] ?? mockHoldingFor(wallet, a);
    if (!weight) throw new Error(`You hold no $${a.ticker}. Buy some to get a vote.`);
    mutate((w) => patchVote(w, voteId, { tallies: { ...v.tallies, [option]: (v.tallies[option] ?? 0) + weight }, voters: [{ wallet, option, weight, at: Date.now() }, ...v.voters] }));
    useBoss.setState((st) => ({ myVotes: { ...st.myVotes, [voteId]: option } }));
  },

  async propose(agentId, field, wallet, reason) {
    await new Promise((r) => setTimeout(r, 600)); // "signing"
    let id = "";
    mutate((w) => {
      const a = getAgent(w, agentId);
      if (!a || (a.status !== "working" && a.status !== "idle")) throw new Error("Agent is not employed");
      if (liveVotes(w).some((v) => v.agentId === agentId && v.field === field)) throw new Error("A vote on that is already live");
      const v = openVote(w, rng, a, field, Date.now(), wallet);
      patchVote(w, v.id, { reason });
      id = v.id;
      // proposal fee goes to the agent's vault
      patchAgent(w, agentId, { vault: +(a.vault + SIM.PROPOSAL_FEE).toFixed(3) });
    });
    return id;
  },

  async rate(reportId, up) {
    mutate((w) => rateReport(w, reportId, up));
    useBoss.setState((st) => ({ myRatings: { ...st.myRatings, [reportId]: up } }));
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

/** Dev tools / tests: force-close a vote now, or wipe the saved world. */
export function debugCloseVote(id: string) {
  mutate((w) => {
    const v = w.votes[id];
    if (v) closeVote(w, rng, v, Date.now());
  });
}
export function resetWorld() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {}
  location.reload();
}
