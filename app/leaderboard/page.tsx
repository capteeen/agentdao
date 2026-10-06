"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAgents, useBoss, useVotes } from "@/lib/store";
import type { Agent } from "@/lib/types";
import { duration, sol } from "@/lib/util";
import { LABEL } from "@/lib/rules";
import Face from "@/components/Face";
import { Loading } from "@/components/Chrome";
import { ObedienceBadge, Pnl, ReportCardView, useNow } from "@/components/Widgets";

const TABS = [
  ["pnl", "Best PnL"],
  ["fees", "Most fees paid to holders"],
  ["votes", "Most votes"],
  ["tenure", "Longest employed"],
  ["fired", "Hall of fired"],
] as const;
type Tab = (typeof TABS)[number][0];

export default function Leaderboard() {
  const ready = useBoss((s) => s.ready);
  const agents = useAgents();
  const votes = useVotes();
  const agentMap = useBoss((s) => s.agents);
  const reports = useBoss((s) => s.reports);
  const now = useNow(5000);
  const [tab, setTab] = useState<Tab>("pnl");

  const voteCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const v of votes) m[v.agentId] = (m[v.agentId] ?? 0) + 1;
    return m;
  }, [votes]);

  const rows = useMemo(() => {
    const employed = agents.filter((a) => a.status === "working" || a.status === "idle");
    const gone = agents.filter((a) => a.status === "fired" || a.status === "bankrupt");
    const by = (xs: Agent[], k: (a: Agent) => number) => [...xs].sort((a, b) => k(b) - k(a));
    switch (tab) {
      case "pnl":
        return by(employed, (a) => a.pnl7d);
      case "fees":
        return by(agents, (a) => a.feesPaidToHolders);
      case "votes":
        return by(agents, (a) => voteCount[a.id] ?? 0);
      case "tenure":
        return by(employed, (a) => now - a.bornAt);
      case "fired":
        return by(gone, (a) => a.firedAt ?? 0);
    }
  }, [agents, tab, voteCount, now]);

  const metric = (a: Agent) => {
    switch (tab) {
      case "pnl":
        return <Pnl v={a.pnl7d} />;
      case "fees":
        return `${sol(a.feesPaidToHolders)} SOL`;
      case "votes":
        return `${voteCount[a.id] ?? 0} votes`;
      case "tenure":
        return duration(now - a.bornAt);
      case "fired":
        return <span className="text-stamp">{a.causeOfDeath}</span>;
    }
  };

  const latestReports = useMemo(() => [...reports].sort((a, b) => b.at - a.at).slice(0, 6), [reports]);

  if (!ready) return <Loading />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="h-pixel text-lg">LEADERBOARD</h1>
      <div className="mt-4 flex flex-wrap gap-1">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`tag !py-2 ${tab === k ? "!bg-memo !text-[#1b1815]" : ""}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="px-box p-2">
          {rows.slice(0, 50).map((a, i) => (
            <Link key={a.id} href={`/agent/${a.id}`} className="flex items-center gap-3 border-b-2 border-line p-2 text-xl hover:bg-panel2">
              <span className={`h-pixel w-8 text-[11px] ${i < 3 ? "text-memo" : "text-dim"}`}>{i + 1}</span>
              <Face image={a.image} className="text-2xl" />
              <div className="min-w-0 flex-1">
                <p className="h-pixel truncate text-[9px]">${a.ticker}</p>
                <p className="truncate text-base text-dim">
                  {a.name} · {LABEL[a.rules.strategy]} · {LABEL[a.rules.risk]}
                </p>
              </div>
              <span className="hidden sm:block">
                <ObedienceBadge value={a.obedience} />
              </span>
              <span className="text-right">{metric(a)}</span>
            </Link>
          ))}
          {!rows.length && <p className="p-4 text-dim">Nobody here yet.</p>}
        </div>
        <aside>
          <h2 className="h-pixel mb-3 text-[11px] uppercase">🔔 Latest report cards</h2>
          <div className="space-y-3">
            {latestReports.map((r) => (
              <ReportCardView key={r.id} r={r} agent={agentMap[r.agentId]} />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
