"use client";

import { useMemo, useState } from "react";
import Office from "@/components/Office";
import AgentCard from "@/components/AgentCard";
import { Loading } from "@/components/Chrome";
import { Ticker } from "@/components/Widgets";
import { useBoss } from "@/lib/store";
import { LABEL, RISKS, STRATEGIES } from "@/lib/rules";
import type { Agent } from "@/lib/types";

type Sort = "pnl" | "vault" | "votes";

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="h-pixel mr-1 text-[8px] uppercase text-dim">{label}</span>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} className={`tag ${value === o ? "!bg-memo !text-[#1b1815]" : ""}`}>
          {o === "all" ? "All" : (LABEL[o] ?? o)}
        </button>
      ))}
    </div>
  );
}

export default function OfficePage() {
  const ready = useBoss((s) => s.ready);
  const agents = useBoss((s) => s.agents);
  const votes = useBoss((s) => s.votes);
  const [strategy, setStrategy] = useState<"all" | Agent["rules"]["strategy"]>("all");
  const [risk, setRisk] = useState<"all" | Agent["rules"]["risk"]>("all");
  const [status, setStatus] = useState<"all" | "working" | "sweating" | "fired">("all");
  const [sort, setSort] = useState<Sort>("pnl");

  const voteCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const v of votes) m[v.agentId] = (m[v.agentId] ?? 0) + 1;
    return m;
  }, [votes]);

  const match = useMemo(
    () => (a: Agent) =>
      (strategy === "all" || a.rules.strategy === strategy) &&
      (risk === "all" || a.rules.risk === risk) &&
      (status === "all" ? true : status === "working" ? a.status === "working" : status === "sweating" ? a.status === "working" && a.lossStreak >= 3 : a.status === "fired" || a.status === "bankrupt"),
    [strategy, risk, status],
  );
  const list = useMemo(() => {
    const xs = agents.filter(match).filter((a) => status === "fired" || a.status === "working" || a.status === "idle");
    const key = (a: Agent) => (sort === "pnl" ? a.pnl7d : sort === "vault" ? a.vault : voteCount[a.id] ?? 0);
    return xs.sort((a, b) => key(b) - key(a));
  }, [agents, match, sort, voteCount, status]);

  if (!ready) return <Loading />;
  return (
    <div>
      <Ticker />
      <div className="mx-auto max-w-7xl px-4">
        <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
          <h1 className="h-pixel text-lg">THE OFFICE FLOOR</h1>
          <p className="text-lg text-dim">Click a desk to visit. Drag to rotate. Desk size = vault size. Mat colour = risk level.</p>
        </div>
        <div className="mt-3 space-y-2 px-box p-3">
          <Seg label="Strategy" value={strategy} options={["all", ...STRATEGIES] as const} onChange={setStrategy} />
          <Seg label="Risk" value={risk} options={["all", ...RISKS] as const} onChange={setRisk} />
          <Seg label="Status" value={status} options={["all", "working", "sweating", "fired"] as const} onChange={setStatus} />
          <Seg label="Sort" value={sort} options={["pnl", "vault", "votes"] as const} onChange={setSort} />
        </div>
      </div>
      <div className="mt-2">
        <Office height="clamp(360px, 55vw, 680px)" filter={match} />
      </div>
      <div className="mx-auto mt-6 max-w-7xl px-4">
        <p className="h-pixel mb-3 text-[9px] uppercase text-dim">{list.length} agents</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {list.map((a) => (
            <AgentCard key={a.id} a={a} votes={voteCount[a.id] ?? 0} />
          ))}
        </div>
      </div>
    </div>
  );
}
