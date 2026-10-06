"use client";

import Face from "@/components/Face";
import Link from "next/link";
import { useState } from "react";
import { useBoss } from "@/lib/store";
import { backend } from "@/lib/backend";
import { FIELD_LABEL, optionLabel, ruleValueLabel } from "@/lib/rules";
import { ago, short, solscanTx } from "@/lib/util";
import type { RuleField } from "@/lib/types";
import { Loading, WalletButton } from "@/components/Chrome";
import { useMyWallet } from "@/components/Providers";
import { Tally, useCountdown, useNow } from "@/components/Widgets";
import { sfx } from "@/components/sound";

export default function VotePage({ params }: { params: { id: string } }) {
  const ready = useBoss((s) => s.ready);
  const v = useBoss((s) => s.votes[params.id]);
  const a = useBoss((s) => (v ? s.agents[v.agentId] : undefined));
  const countdown = useCountdown();
  const myVote = useBoss((s) => s.myVotes[params.id]);
  const holding = useBoss((s) => (v ? s.holdings[v.agentId] ?? 0 : 0));
  const sound = useBoss((s) => s.prefs.sound);
  const { address, ensure } = useMyWallet();
  const now = useNow(250);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  if (!ready) return <Loading />;
  if (!v || !a)
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="h-pixel text-sm">VOTE NOT FOUND</p>
        <p className="mt-2 text-xl text-dim">Mock worlds reset on reload.</p>
        <Link href="/office" className="px-btn mt-6">
          Back to the office
        </Link>
      </div>
    );

  const total = Object.values(v.tallies).reduce((s, x) => s + x, 0);
  const left = v.endsAt - now;
  const isRule = v.field !== "fire" && v.field !== "raise";
  const voters = [...v.voters].sort((x, y) => y.weight - x.weight);
  const weightPct = (holding / v.snapshotSupply) * 100;

  const cast = async (opt: string) => {
    const who = ensure(a.id); // no wallet yet? spin up a demo one (holding this coin) and vote with it
    setBusy(opt);
    setErr("");
    try {
      await backend.vote(v.id, opt, who);
      if (sound) sfx.stamp();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Link href={`/agent/${a.id}`} className="text-xl text-dim hover:text-memo">
        ← <Face image={a.image} /> ${a.ticker} · {a.name}
      </Link>
      <div className="memo-card mt-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="h-pixel text-[8px] uppercase opacity-70">
              Board proposal #{v.id} · by {short(v.proposer)}
            </p>
            <h1 className="h-pixel mt-2 text-sm leading-relaxed sm:text-base">
              {v.field === "fire" ? `Fire $${a.ticker}?` : v.field === "raise" ? `Give $${a.ticker} a raise?` : `Change ${FIELD_LABEL[v.field].toLowerCase()} for $${a.ticker}`}
            </h1>
            {isRule && <p className="mt-1 text-xl">Current rule: {ruleValueLabel(v.field as RuleField, a.rules)}</p>}
            {v.reason && <p className="mt-1 text-xl italic">&ldquo;{v.reason}&rdquo;</p>}
          </div>
          <div className="text-right">
            {v.status === "live" ? (
              <>
                <p className="h-pixel text-[8px] uppercase opacity-70">Closes in</p>
                <p className={`h-pixel text-2xl ${left < 15000 ? "text-[#e63946] blink" : ""}`}>{countdown(left)}</p>
              </>
            ) : (
              <span className={`stamp-mark ${v.status === "passed" && !(v.field === "fire" && v.winner === "fire") ? "ok" : ""}`}>{v.status === "passed" ? (v.field === "fire" && v.winner === "fire" ? "Fired" : "Approved") : "No quorum"}</span>
            )}
          </div>
        </div>

        <div className="mt-5 [&_.bar]:bg-[#1b1815]/10 [&_.text-dim]:text-[#1b1815]/60 [&_.text-ok]:font-bold [&_.text-ok]:text-[#2e8c46]">
          <Tally vote={v} />
        </div>

        {v.status === "live" && (
          <div className="mt-5 border-t-4 border-dashed border-[#1b1815]/30 pt-4">
            {!address ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xl">Give the order:</span>
                {v.options.map((o) => (
                  <button key={o} className={`px-btn ${o === "fire" ? "stamp" : ""}`} disabled={!!busy} onClick={() => cast(o)}>
                    {busy === o ? "…" : optionLabel(v.field, o)}
                  </button>
                ))}
                <span className="w-full text-base opacity-70">
                  No wallet? Clicking creates a demo wallet so you can try it. <WalletButton compact />
                </span>
              </div>
            ) : (
              <>
                <p className="text-xl">
                  Your voting weight: <b>{holding ? `${(holding / 1e6).toFixed(2)}M $${a.ticker} (${weightPct.toFixed(2)}% of supply)` : "0, you don't hold this coin"}</b>
                  <span className="block text-base opacity-70">Snapshot taken when the vote opened ({ago(v.startsAt, now)}).</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {v.options.map((o) => (
                    <button key={o} className={`px-btn ${o === "fire" ? "stamp" : myVote === o ? "ok" : ""}`} disabled={!!myVote || !holding || !!busy} onClick={() => cast(o)}>
                      {busy === o ? "…" : myVote === o ? `✓ ${optionLabel(v.field, o)}` : optionLabel(v.field, o)}
                    </button>
                  ))}
                </div>
                {myVote && <p className="mt-2 text-xl">Vote recorded. Signed off-chain, counted by weight.</p>}
                {!holding && (
                  <a className="mt-2 inline-block text-lg underline" href={`https://pump.fun/coin/${a.coinCa}`} target="_blank" rel="noreferrer">
                    Buy ${a.ticker} on pump.fun to get a vote ↗
                  </a>
                )}
              </>
            )}
            {err && <p className="mt-2 text-xl text-[#e63946]">{err}</p>}
          </div>
        )}

        {v.status === "passed" && (
          <div className="mt-5 border-t-4 border-dashed border-[#1b1815]/30 pt-4 text-xl">
            <p>
              Winner: <b>{optionLabel(v.field, v.winner!)}</b>. The agent complied in slot {v.executedSlot?.toLocaleString()}, 1 block after the vote closed.
            </p>
            {v.txSig && (
              <a className="underline" href={solscanTx(v.txSig)} target="_blank" rel="noreferrer">
                Execution tx {short(v.txSig, 6)} ↗
              </a>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="px-box p-3">
          <p className="h-pixel text-[7px] uppercase text-dim">Turnout</p>
          <p className="text-2xl">{((total / v.snapshotSupply) * 100).toFixed(2)}%</p>
        </div>
        <div className="px-box p-3">
          <p className="h-pixel text-[7px] uppercase text-dim">Quorum</p>
          <p className="text-2xl">5% of supply</p>
        </div>
        <div className="px-box p-3">
          <p className="h-pixel text-[7px] uppercase text-dim">Voters</p>
          <p className="text-2xl">{v.voters.length || "-"}</p>
        </div>
      </div>

      <h2 className="h-pixel mb-2 mt-8 text-[11px] uppercase">Voters by weight</h2>
      <div className="px-box p-3">
        {voters.length === 0 ? (
          <p className="text-dim">No individual ballots recorded{v.status !== "live" ? " (historical vote)" : " yet"}.</p>
        ) : (
          voters.slice(0, 50).map((x, i) => (
            <div key={x.wallet + i} className={`flex gap-2 border-b-2 border-line py-1 text-lg ${x.wallet === address ? "text-memo" : ""}`}>
              <span className="w-8 text-dim">{i + 1}</span>
              <span className="font-mono text-base">{short(x.wallet, 5)}</span>
              <span className="ml-auto">{optionLabel(v.field, x.option)}</span>
              <span className="w-28 text-right text-dim">{((x.weight / v.snapshotSupply) * 100).toFixed(3)}%</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
