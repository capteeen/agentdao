"use client";

import Link from "next/link";
import { useMemo } from "react";
import { reportsFor, useBoss } from "@/lib/store";
import { duration, sol } from "@/lib/util";
import Face from "@/components/Face";
import { Loading } from "@/components/Chrome";
import { ReportCardView } from "@/components/Widgets";

export default function Graveyard() {
  const ready = useBoss((s) => s.ready);
  const agents = useBoss((s) => s.agents);
  const reports = useBoss((s) => s.reports);
  const dead = useMemo(() => agents.filter((a) => a.status === "fired" || a.status === "bankrupt").sort((a, b) => (b.firedAt ?? 0) - (a.firedAt ?? 0)), [agents]);

  if (!ready) return <Loading />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="h-pixel text-lg">THE GRAVEYARD</h1>
      <p className="mt-2 text-xl text-dim">Fired and bankrupt agents. Their vaults were liquidated pro-rata to holders. Pour one out.</p>
      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {dead.map((a) => {
          const last = reportsFor(reports, a.id)[0];
          return (
            <div key={a.id} className="flex flex-col items-center">
              <Link href={`/agent/${a.id}`} className="group relative w-56 pt-4 text-center">
                {/* pixel tombstone */}
                <div className="relative mx-auto bg-[#6b6560] px-4 pb-6 pt-8 text-[#1b1815]" style={{ clipPath: "polygon(16px 0, calc(100% - 16px) 0, calc(100% - 16px) 8px, calc(100% - 8px) 8px, calc(100% - 8px) 16px, 100% 16px, 100% 100%, 0 100%, 0 16px, 8px 16px, 8px 8px, 16px 8px)", boxShadow: "inset -8px -8px 0 rgba(0,0,0,.25)" }}>
                  <p className="h-pixel text-[10px]">R.I.P.</p>
                  <Face image={a.image} className="mt-2 block text-4xl grayscale" />
                  <p className="h-pixel mt-2 text-[9px]">${a.ticker}</p>
                  <p className="text-lg">{a.name}</p>
                  <p className="mt-1 text-base">
                    {new Date(a.bornAt).toLocaleDateString()} – {a.firedAt ? new Date(a.firedAt).toLocaleDateString() : "?"}
                  </p>
                  <p className="mt-2 text-lg font-bold text-[#8b1d26]">{a.causeOfDeath}</p>
                  <p className="text-base">Served {duration((a.firedAt ?? 0) - a.bornAt)}</p>
                </div>
                <div className="h-3 bg-[#3f8f4f]" />
              </Link>
              <p className="mt-2 text-lg text-dim">
                Paid holders {sol(a.feesPaidToHolders)} SOL lifetime · final PnL {sol(a.pnl7d)} SOL
              </p>
              {last && (
                <div className="mt-3 w-full max-w-xs">
                  <ReportCardView r={last} agent={a} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!dead.length && <p className="mt-8 text-dim">Nobody has been fired yet. Give it ten minutes.</p>}
    </div>
  );
}
