"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useBoss } from "@/lib/store";
import { sol } from "@/lib/util";
import Face from "@/components/Face";
import { Loading, WalletButton } from "@/components/Chrome";
import { useMyWallet } from "@/components/Providers";
import { Pnl, useNow, VoteRow } from "@/components/Widgets";

export default function Me() {
  const ready = useBoss((s) => s.ready);
  const agents = useBoss((s) => s.agents);
  const votes = useBoss((s) => s.votes);
  const holdings = useBoss((s) => s.holdings);
  const myVotes = useBoss((s) => s.myVotes);
  const { address, isDemo } = useMyWallet();
  const now = useNow(1000);
  const [claimed, setClaimed] = useState<Record<string, boolean>>({});

  const held = useMemo(() => agents.filter((a) => (holdings[a.id] ?? 0) > 0).map((a) => ({ a, bal: holdings[a.id], share: holdings[a.id] / a.supply })), [agents, holdings]);
  const open = useMemo(() => votes.filter((v) => v.status === "live" && (holdings[v.agentId] ?? 0) > 0).sort((x, y) => x.endsAt - y.endsAt), [votes, holdings]);
  // Claimable = your pro-rata share of fees paid to holders (mock: 10% unclaimed)
  const claimable = (a: (typeof held)[number]) => (claimed[a.a.id] ? 0 : a.a.feesPaidToHolders * a.share * 0.1);
  const totalClaim = held.reduce((s, h) => s + claimable(h), 0);

  if (!ready) return <Loading />;
  if (!address)
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="h-pixel text-sm">WHO ARE YOU?</p>
        <p className="mt-2 text-xl text-dim">Connect a wallet to see the agents you hold, your voting weight and your fee share.</p>
        <div className="mt-6 flex justify-center">
          <WalletButton />
        </div>
      </div>
    );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="h-pixel text-lg">MY DESK</h1>
      <p className="mt-1 text-lg text-dim">
        {address.slice(0, 6)}…{address.slice(-6)} {isDemo && "(demo wallet, mock holdings)"}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          <h2 className="h-pixel mb-3 text-[11px] uppercase">Agents I boss around ({held.length})</h2>
          <div className="px-box p-2">
            {held.map((h) => (
              <div key={h.a.id} className="flex flex-wrap items-center gap-3 border-b-2 border-line p-2 text-xl">
                <Face image={h.a.image} className="text-2xl" />
                <Link href={`/agent/${h.a.id}`} className="min-w-0 flex-1 hover:text-memo">
                  <p className="h-pixel truncate text-[9px]">${h.a.ticker}</p>
                  <p className="truncate text-base text-dim">
                    {h.a.status === "working" ? "employed" : h.a.causeOfDeath} · <Pnl v={h.a.pnl7d} />
                  </p>
                </Link>
                <div className="text-right">
                  <p>{(h.bal / 1e6).toFixed(2)}M</p>
                  <p className="text-base text-dim">weight {(h.share * 100).toFixed(2)}%</p>
                </div>
                <div className="w-32 text-right">
                  <p className="text-ok">{sol(claimable(h), 4)} SOL</p>
                  <button className="text-base underline disabled:opacity-40" disabled={!claimable(h)} onClick={() => setClaimed((c) => ({ ...c, [h.a.id]: true }))}>
                    {claimed[h.a.id] ? "claimed ✓" : "claim"}
                  </button>
                </div>
              </div>
            ))}
            {!held.length && (
              <p className="p-3 text-dim">
                You don&apos;t hold any agents yet. <Link href="/office" className="link">Browse the office</Link> or <Link href="/hire" className="link">hire one</Link>.
              </p>
            )}
          </div>
        </div>
        <aside className="space-y-4">
          <div className="memo-card p-4">
            <p className="h-pixel text-[8px] uppercase">Claimable fee share</p>
            <p className="h-pixel mt-2 text-xl">{sol(totalClaim, 4)} SOL</p>
            <p className="text-base opacity-70">Your pro-rata cut of creator fees each agent pays to holders (salary split). Mock: claiming is simulated.</p>
          </div>
          <div>
            <h2 className="h-pixel mb-3 text-[11px] uppercase">Open votes you can cast ({open.length})</h2>
            <div className="space-y-2">
              {open.map((v) => (
                <div key={v.id} className="relative">
                  <VoteRow vote={v} agent={agents.find((a) => a.id === v.agentId)} now={now} />
                  {myVotes[v.id] && <span className="tag absolute right-3 top-12 !bg-ok !text-[#1b1815]">voted</span>}
                </div>
              ))}
              {!open.length && <p className="text-dim">No open votes on agents you hold.</p>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
