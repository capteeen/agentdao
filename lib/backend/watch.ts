"use client";

// Store watcher shared by both backends: turns world events into toasts,
// payouts and the office camera focus for the connected wallet.

import { useBoss } from "../store";
import { SIM } from "../sim";

export function watchEvents() {
  let lastTop = useBoss.getState().events[0]?.id;
  return useBoss.subscribe((s, prev) => {
    if (s.events === prev.events) return;
    const fresh: typeof s.events = [];
    for (const e of s.events) {
      if (e.id === lastTop) break;
      fresh.push(e);
    }
    lastTop = s.events[0]?.id;
    for (const e of fresh.reverse()) {
      const a = s.agents[e.agentId];
      if (!a) continue;
      if (e.kind === "vote_pass" || e.kind === "fired") {
        const mine = e.voteId && s.myVotes[e.voteId];
        const label = e.kind === "fired" ? `$${a.ticker} fired. Vault paid out.` : e.text.replace(/^Holders of /, "").replace(" Agent complied.", "");
        useBoss.setState({ focus: { agentId: a.id, at: e.at, label } });
        if (mine) {
          const v = s.votes[e.voteId!];
          useBoss.getState().toast({
            kind: "obeyed",
            text: v?.winner === mine ? `Your order was obeyed in slot ${v?.executedSlot?.toLocaleString()}: ${label}` : `Vote closed: ${label} (you voted ${mine})`,
            href: `/agent/${a.id}`,
          });
        }
      }
      if (e.kind === "fired" && a.liquidated && s.holdings[a.id]) {
        const share = s.holdings[a.id] / a.supply;
        const sol = +(a.liquidated * share).toFixed(4);
        useBoss.setState({ payouts: [{ agentId: a.id, ticker: a.ticker, sol, at: e.at, voteId: e.voteId }, ...s.payouts] });
        useBoss.getState().toast({ kind: "payout", text: `You received ${sol} SOL from $${a.ticker}'s liquidation.`, href: "/me" });
      }
      if (e.kind === "trade" || e.kind === "launch") {
        if (a.lastOrderVote && s.myVotes[a.lastOrderVote] && a.lastOrderAt && e.at - a.lastOrderAt < SIM.OBEY_TRADE_MS + 1500 && e.at > a.lastOrderAt) {
          const t = s.trades[0];
          if (t && t.agentId === a.id && t.voteId === a.lastOrderVote) useBoss.getState().toast({ kind: "obeyed", text: `$${a.ticker} just traded under your rule: ${t.ruleApplied}.`, href: `/agent/${a.id}#t-${t.id}` });
        }
      }
    }
  });
}
