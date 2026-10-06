"use client";

// Phase 2 client. Same interface as the simulator; the UI does not change when
// you flip NEXT_PUBLIC_BOSS_BACKEND=live.
//
//   server (worker + app/api/*) ──SSE /api/stream──▶ start() ──▶ store
//   UI ──vote()/propose()/hire()──▶ signer signs ──▶ POST /api/*

import { Connection, VersionedTransaction } from "@solana/web3.js";
import type { BossBackend } from "./types";
import { useBoss } from "../store";
import type { World } from "../sim";
import { getSigner } from "./signer";
import { watchEvents } from "./watch";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(j.error ?? "Request failed");
  return j as T;
}

function signer(wallet: string) {
  const s = getSigner();
  if (!s || s.address !== wallet) throw new Error("Connect a wallet (or use the demo wallet) to sign.");
  return s;
}

export const liveBackend: BossBackend = {
  name: "live",

  start() {
    let es: EventSource | null = null;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/stream");
      es.onmessage = (m) => {
        const msg = JSON.parse(m.data) as { type: "snapshot"; world: World } | { type: "patch"; world: Partial<World> };
        if (msg.type === "snapshot") return useBoss.setState({ ...msg.world, ready: true, backend: "live" });
        // Patches merge by id: agents/votes are maps, logs are prepended.
        useBoss.setState((s) => {
          const dedupe = <T extends { id: string }>(fresh: T[] | undefined, old: T[], cap: number) => {
            if (!fresh) return old;
            const ids = new Set(fresh.map((x) => x.id));
            return [...fresh, ...old.filter((x) => !ids.has(x.id))].slice(0, cap);
          };
          return {
            agents: msg.world.agents ? { ...s.agents, ...msg.world.agents } : s.agents,
            votes: msg.world.votes ? { ...s.votes, ...msg.world.votes } : s.votes,
            trades: dedupe(msg.world.trades, s.trades, 3000),
            events: dedupe(msg.world.events, s.events, 400),
            reports: dedupe(msg.world.reports, s.reports, 600),
            slot: msg.world.slot ?? s.slot,
          };
        });
      };
      es.onerror = () => {
        es?.close();
        setTimeout(connect, 2000);
      };
    };
    connect();
    const unsub = watchEvents();
    return () => {
      stopped = true;
      unsub();
      es?.close();
    };
  },

  async holdings(wallet) {
    const { holdings, demoStake } = await post<{ holdings: Record<string, number>; demoStake: number }>("/api/holdings", { wallet });
    // paper mode: a demo wallet self-declares a small stake in every agent (the server caps it at 1% per ballot)
    if (getSigner()?.isDemo && demoStake) for (const id of Object.keys(useBoss.getState().agents)) holdings[id] = Math.max(holdings[id] ?? 0, demoStake);
    return holdings;
  },

  async vote(voteId, option, wallet) {
    const sg = signer(wallet);
    const signature = await sg.signMessage(`BOSS vote ${voteId} ${option}`);
    const paperWeight = sg.isDemo ? useBoss.getState().holdings[useBoss.getState().votes[voteId]?.agentId ?? ""] : undefined;
    await post("/api/vote", { voteId, option, wallet, signature, paperWeight });
    useBoss.setState((st) => ({ myVotes: { ...st.myVotes, [voteId]: option } }));
  },

  async propose(agentId, field, wallet, reason) {
    const sg = signer(wallet);
    const signature = await sg.signMessage(`BOSS propose ${agentId} ${field}`);
    // live mode also needs the fee transfer; the server tells us if it is missing
    const { id } = await post<{ id: string }>("/api/propose", { agentId, field, wallet, reason, signature });
    return id;
  },

  async rate(reportId, up) {
    const sg = getSigner();
    if (!sg) throw new Error("Connect a wallet to rate");
    const signature = await sg.signMessage(`BOSS rate ${reportId} ${up ? "up" : "down"}`);
    await post("/api/rate", { reportId, up, wallet: sg.address, signature });
    useBoss.setState((st) => ({ myRatings: { ...st.myRatings, [reportId]: up } }));
  },

  async hire(input, wallet) {
    const sg = signer(wallet);
    const res = await post<{ id: string; tx?: string; mint: string }>("/api/hire", { ...input, wallet });
    if (res.tx) {
      // live: sign the pump.fun create tx and send it
      if (!sg.signTransaction) throw new Error("This wallet cannot sign transactions");
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(res.tx), (c) => c.charCodeAt(0)));
      const signed = await sg.signTransaction(tx);
      const rpc = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com", "confirmed");
      const sig = await rpc.sendRawTransaction(signed.serialize(), { maxRetries: 3 });
      await rpc.confirmTransaction(sig, "confirmed");
      await post("/api/hire/confirm", { id: res.id, signature: sig });
    }
    useBoss.setState((s) => ({ holdings: { ...s.holdings, [res.id]: Math.floor(1_000_000_000 * 0.04) } }));
    return res.id;
  },
};
