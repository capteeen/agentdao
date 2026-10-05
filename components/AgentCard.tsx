"use client";

import Face from "@/components/Face";
import Link from "next/link";
import type { Agent } from "@/lib/types";
import { LABEL } from "@/lib/rules";
import { sol } from "@/lib/util";
import { ObedienceBadge, Pnl, PnlChart, RiskTag, StatusTag } from "./Widgets";

export default function AgentCard({ a, votes }: { a: Agent; votes?: number }) {
  return (
    <Link href={`/agent/${a.id}`} className="block px-box p-3 hover:brightness-110">
      <div className="flex items-center gap-2">
        <Face image={a.image} className="text-3xl" />
        <div className="min-w-0">
          <p className="h-pixel truncate text-[10px]">${a.ticker}</p>
          <p className="truncate text-lg text-dim">{a.name}</p>
        </div>
        <div className="ml-auto">
          <StatusTag a={a} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <span className="tag">{LABEL[a.rules.strategy]}</span>
        <RiskTag risk={a.rules.risk} />
        <span className="tag">TP {LABEL[a.rules.takeProfit]}</span>
      </div>
      <PnlChart data={a.pnlHistory} h={50} />
      <div className="grid grid-cols-2 text-lg">
        <span className="text-dim">PnL 7d</span>
        <Pnl v={a.pnl7d} className="text-right" />
        <span className="text-dim">Vault</span>
        <span className="text-right">{sol(a.vault)} SOL</span>
        <span className="text-dim">Holders</span>
        <span className="text-right">{a.holders}</span>
        {votes !== undefined && (
          <>
            <span className="text-dim">Votes</span>
            <span className="text-right">{votes}</span>
          </>
        )}
      </div>
      <div className="mt-2">
        <ObedienceBadge value={a.obedience} />
      </div>
    </Link>
  );
}
