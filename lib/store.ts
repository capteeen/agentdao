"use client";

import { create } from "zustand";
import type { Agent, BossEvent, ReportCard, Trade, Vote } from "./types";
import type { World } from "./sim";

export interface Prefs {
  theme: "dark" | "light";
  sound: boolean;
}

export interface BossState extends World {
  ready: boolean;
  backend: "sim" | "live";
  /** Wallet holdings snapshot per agent id (mock: derived from the pubkey). */
  holdings: Record<string, number>;
  /** Votes this browser cast: voteId -> option. */
  myVotes: Record<string, string>;
  /** Wallet used when no extension is installed ("demo wallet"). */
  demoWallet: string | null;
  prefs: Prefs;
  bell: number; // bumps when report cards are posted
  setPrefs(p: Partial<Prefs>): void;
}

export const emptyWorld: World = { agents: [], votes: [], trades: [], events: [], reports: [], slot: 0, seq: 0, nextAgentNo: 1 };

export const useBoss = create<BossState>()((set) => ({
  ...emptyWorld,
  ready: false,
  backend: "sim",
  holdings: {},
  myVotes: {},
  demoWallet: null,
  prefs: { theme: "dark", sound: false },
  bell: 0,
  setPrefs: (p) =>
    set((s) => {
      const prefs = { ...s.prefs, ...p };
      try {
        localStorage.setItem("boss:prefs", JSON.stringify(prefs));
      } catch {}
      return { prefs };
    }),
}));

/** Apply a mutation to the world (sim + live backends both use this). */
export function mutate(fn: (w: World) => void) {
  const s = useBoss.getState();
  const w: World = { agents: s.agents, votes: s.votes, trades: s.trades, events: s.events, reports: s.reports, slot: s.slot, seq: s.seq, nextAgentNo: s.nextAgentNo };
  fn(w);
  useBoss.setState({ ...w });
}

// ---------------------------------------------------------------- selectors

export const useAgent = (id: string): Agent | undefined => useBoss((s) => s.agents.find((a) => a.id === id));
export const useVote = (id: string): Vote | undefined => useBoss((s) => s.votes.find((v) => v.id === id));

export function selectCounters(s: Pick<BossState, "agents" | "votes">) {
  let employed = 0,
    fired = 0,
    sum = 0;
  for (const a of s.agents) {
    if (a.status === "working" || a.status === "idle") {
      employed++;
      sum += a.vault;
    } else fired++;
  }
  const votesPassed = s.votes.reduce((n, v) => n + (v.status === "passed" ? 1 : 0), 0);
  return { employed, fired, sum, votesPassed };
}

export function topEarnerId(agents: Agent[]): string | undefined {
  let best: Agent | undefined;
  for (const a of agents) if (a.status === "working" && (!best || a.pnl7d > best.pnl7d)) best = a;
  return best?.id;
}

export const tradesFor = (trades: Trade[], id: string) => trades.filter((t) => t.agentId === id);
export const reportsFor = (reports: ReportCard[], id: string) => reports.filter((r) => r.agentId === id).sort((a, b) => b.at - a.at);
export const eventsFor = (events: BossEvent[], id: string) => events.filter((e) => e.agentId === id);
