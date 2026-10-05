"use client";

// Phase 2 backend (STUB). Same interface as the simulator; the UI does not
// change when you flip NEXT_PUBLIC_BOSS_BACKEND=live.
//
// Data flow:
//   server (app/api/*, worker) ──SSE /api/stream──▶ live.start() ──▶ mutate(store)
//   UI ──vote()/propose()/hire()──▶ wallet signs message/tx ──▶ POST /api/*
//
// See README "Swapping the simulator for the Phase 2 backend".

import type { BossBackend } from "./types";
import { useBoss } from "../store";
import type { World } from "../sim";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? "Request failed");
  return res.json();
}

export const liveBackend: BossBackend = {
  name: "live",

  start() {
    // TODO(phase2): /api/stream emits {type:"snapshot", world} once, then
    // {type:"patch", ...} deltas (trade, vote tally, vote pass, fired, report).
    const es = new EventSource("/api/stream");
    es.onmessage = (m) => {
      const msg = JSON.parse(m.data) as { type: "snapshot"; world: World } | { type: "patch"; world: Partial<World> };
      useBoss.setState({ ...msg.world, ready: true, backend: "live" });
    };
    return () => es.close();
  },

  async holdings(wallet) {
    // Server reads balances via DAS getTokenAccounts / getTokenLargestAccounts.
    return post<Record<string, number>>("/api/holdings", { wallet });
  },

  async vote(voteId, option, wallet) {
    // TODO(phase2): sign `BOSS vote ${voteId} ${option}` with wallet.signMessage
    // and include the signature; server verifies ed25519 + snapshot weight.
    await post("/api/vote", { voteId, option, wallet, signature: "TODO" });
  },

  async propose(agentId, field, wallet, reason) {
    // TODO(phase2): build + sign a SystemProgram.transfer(PROPOSAL_FEE) to the
    // agent vault, send it, then POST the signature as proof of fee.
    const { id } = await post<{ id: string }>("/api/propose", { agentId, field, wallet, reason, feeTx: "TODO" });
    return id;
  },

  async hire(input, wallet) {
    // TODO(phase2): server builds the PumpPortal create tx (agent keypair as
    // creator, user pays), returns it serialized; user signs; server submits.
    const { id } = await post<{ id: string }>("/api/hire", { ...input, wallet });
    return id;
  },
};
