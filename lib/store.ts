"use client";

import { create } from "zustand";
import type { Agent, BossEvent, ReportCard, Trade, Vote } from "./types";
import { emptyWorld as makeEmptyWorld, type World } from "./sim";

export interface Prefs {
  theme: "dark" | "light";
  sound: boolean;
  /** Show countdowns in office time (1 mock second = 40 real seconds). */
  officeClock: boolean;
}

export interface Toast {
  id: string;
  kind: "obeyed" | "payout" | "info";
  text: string;
  href?: string;
  at: number;
}

export interface Payout {
  agentId: string;
  ticker: string;
  sol: number;
  at: number;
  voteId?: string;
}

export interface BossState extends World {
  ready: boolean;
  backend: "sim" | "live";
  /** Wallet holdings snapshot per agent id (mock: derived from the pubkey). */
  holdings: Record<string, number>;
  /** Votes this browser cast: voteId -> option. */
  myVotes: Record<string, string>;
  /** Report cards this browser rated: reportId -> up? */
  myRatings: Record<string, boolean>;
  /** Liquidation payouts received by the connected wallet. */
  payouts: Payout[];
  /** Wallet used when no extension is installed ("demo wallet"). */
  demoWallet: string | null;
  prefs: Prefs;
  bell: number; // bumps when report cards are posted
  toasts: Toast[];
  /** Office camera request: focus this agent for a moment. */
  focus: { agentId: string; at: number; label: string } | null;
  setPrefs(p: Partial<Prefs>): void;
  toast(t: Omit<Toast, "id" | "at">): void;
  dismissToast(id: string): void;
}

export const emptyWorld: World = makeEmptyWorld();

const DEFAULT_PREFS: Prefs = { theme: "dark", sound: true, officeClock: false };

export const useBoss = create<BossState>()((set) => ({
  ...emptyWorld,
  ready: false,
  backend: "sim",
  holdings: {},
  myVotes: {},
  myRatings: {},
  payouts: [],
  demoWallet: null,
  prefs: DEFAULT_PREFS,
  bell: 0,
  toasts: [],
  focus: null,
  setPrefs: (p) =>
    set((s) => {
      const prefs = { ...s.prefs, ...p };
      try {
        localStorage.setItem("boss:prefs", JSON.stringify(prefs));
      } catch {}
      return { prefs };
    }),
  toast: (t) =>
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id: Math.random().toString(36).slice(2), at: Date.now() }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const pickWorld = (s: World): World => ({ agents: s.agents, votes: s.votes, trades: s.trades, events: s.events, reports: s.reports, slot: s.slot, seq: s.seq, nextAgentNo: s.nextAgentNo });

/** Apply a mutation to the world (sim + live backends both use this). */
export function mutate(fn: (w: World) => void) {
  const w = pickWorld(useBoss.getState());
  fn(w);
  useBoss.setState({ ...w });
}

// ---------------------------------------------------------------- selectors

export const useAgent = (id: string): Agent | undefined => useBoss((s) => s.agents[id]);
export const useVote = (id: string): Vote | undefined => useBoss((s) => s.votes[id]);

/** Memoised array views. Each only recomputes when its map identity changes. */
const memo = <K extends object, V>(fn: (k: K) => V) => {
  let lastK: K | null = null;
  let lastV: V;
  return (k: K) => {
    if (k !== lastK) {
      lastK = k;
      lastV = fn(k);
    }
    return lastV;
  };
};
export const agentsArray = memo((m: Record<string, Agent>) => Object.values(m));
export const votesArray = memo((m: Record<string, Vote>) => Object.values(m));
export const useAgents = () => agentsArray(useBoss((s) => s.agents));
export const useVotes = () => votesArray(useBoss((s) => s.votes));

export function selectCounters(agents: Agent[], votes: Vote[]) {
  let employed = 0,
    fired = 0,
    sum = 0;
  for (const a of agents) {
    if (a.status === "working" || a.status === "idle") {
      employed++;
      sum += a.vault;
    } else fired++;
  }
  const votesPassed = votes.reduce((n, v) => n + (v.status === "passed" ? 1 : 0), 0);
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
