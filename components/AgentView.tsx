"use client";

import Face from "@/components/Face";
import Link from "next/link";
import { useMemo, useState } from "react";
import { reportsFor, useBoss } from "@/lib/store";
import type { Agent, RuleField, Trade, Vote } from "@/lib/types";
import { CADENCE_DESC, FIELD_LABEL, LABEL, optionLabel, RISK_DESC, ruleValueLabel, STRATEGY_DESC } from "@/lib/rules";
import { ago, duration, pumpUrl, short, sol, solscanAcct, solscanTx } from "@/lib/util";
import { DeskSprite } from "./Office";
import { Loading } from "./Chrome";
import ProposeButton from "./Propose";
import { ObedienceBadge, Pnl, PnlChart, ReportCardView, RiskTag, StatusTag, Tally, useNow, VoteRow } from "./Widgets";

const RULE_ORDER: RuleField[] = ["strategy", "risk", "cadence", "takeProfit", "salaryPct", "copyWallet"];

function RuleSourceLink({ src, votes }: { src: string | undefined; votes: Vote[] }) {
  if (!src || src === "hire") return <span className="text-base opacity-70">founding rule set (hire)</span>;
  const v = votes.find((x) => x.id === src);
  if (!v) return <span className="text-base opacity-70">vote {src}</span>;
  const total = Object.values(v.tallies).reduce((s, x) => s + x, 0) || 1;
  const pct = Math.round(((v.tallies[v.winner!] ?? 0) / total) * 100);
  return (
    <Link href={`/vote/${v.id}`} className="text-base underline decoration-dotted">
      set by vote #{v.id} ({pct}%) · {ago(v.endsAt)}
    </Link>
  );
}

function JobDescription({ a, votes }: { a: Agent; votes: Vote[] }) {
  const desc: Partial<Record<RuleField, string>> = {
    strategy: STRATEGY_DESC[a.rules.strategy],
    risk: RISK_DESC[a.rules.risk],
    cadence: CADENCE_DESC[a.rules.cadence],
    takeProfit: a.rules.takeProfit === "never" ? "Never takes profit on a fixed multiple" : `Sells at ${a.rules.takeProfit}`,
    salaryPct: "Split of creator fees",
  };
  return (
    <div className="memo-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="h-pixel text-[8px] uppercase opacity-70">Job description</p>
          <p className="h-pixel mt-1 text-[11px]">
            {a.name}, ${a.ticker}
          </p>
        </div>
        <span className="stamp-mark ok shrink-0">In force</span>
      </div>
      <ul className="mt-3 space-y-2">
        {RULE_ORDER.filter((f) => a.rules[f] !== undefined).map((f) => (
          <li key={f} id={`rule-${f}`} className="border-b-2 border-dashed border-[#1b1815]/20 pb-1">
            <div className="flex justify-between gap-2 text-xl">
              <span>{FIELD_LABEL[f]}</span>
              <b className="text-right">{ruleValueLabel(f, a.rules)}</b>
            </div>
            {desc[f] && <div className="text-base opacity-80">{desc[f]}</div>}
            <RuleSourceLink src={a.ruleSource[f]} votes={votes} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-base opacity-80">The agent does nothing outside these rules. Change them with a vote.</p>
    </div>
  );
}

function TradeRow({ t, votes, now }: { t: Trade; votes: Vote[]; now: number }) {
  const v = t.voteId !== "hire" ? votes.find((x) => x.id === t.voteId) : undefined;
  const icon = t.kind === "buy" ? "🟦 BUY" : t.kind === "sell" ? "🟨 SELL" : "📞 LAUNCH";
  return (
    <div id={`t-${t.id}`} className="border-b-2 border-line py-2 target:bg-panel2">
      <div className="flex flex-wrap items-center gap-2 text-lg">
        <span className="w-16 text-dim">{ago(t.at, now)}</span>
        <span className="h-pixel text-[8px]">{icon}</span>
        <span>${t.coinTicker}</span>
        <span className="text-dim">{t.amount.toFixed(2)} SOL</span>
        {t.pnl !== undefined && <Pnl v={t.pnl} />}
        {t.txSig && (
          <a href={solscanTx(t.txSig)} target="_blank" rel="noreferrer" className="ml-auto text-base text-dim hover:text-memo">
            tx ↗
          </a>
        )}
      </div>
      <p className="text-xl">{t.reason}</p>
      <p className="text-base">
        <span className="text-dim">Why? → </span>
        <a href={`#rule-${t.ruleField}`} className="text-memo underline decoration-dotted">
          {t.ruleApplied}
        </a>
        <span className="text-dim"> · </span>
        {v ? (
          <Link href={`/vote/${v.id}`} className="text-ok underline decoration-dotted">
            set by vote #{v.id} ({optionLabel(v.field, v.winner!)})
          </Link>
        ) : (
          <span className="text-dim">founding rule set (hire)</span>
        )}
      </p>
    </div>
  );
}

export default function AgentView({ id }: { id: string }) {
  const ready = useBoss((s) => s.ready);
  const a = useBoss((s) => s.agents.find((x) => x.id === id));
  const allVotes = useBoss((s) => s.votes);
  const allTrades = useBoss((s) => s.trades);
  const allReports = useBoss((s) => s.reports);
  const holding = useBoss((s) => s.holdings[id] ?? 0);
  const now = useNow(1000);
  const [tab, setTab] = useState<"trades" | "launches" | "votes" | "reports">("trades");
  const [copied, setCopied] = useState(false);

  const votes = useMemo(() => allVotes.filter((v) => v.agentId === id), [allVotes, id]);
  const trades = useMemo(() => allTrades.filter((t) => t.agentId === id), [allTrades, id]);
  const reports = useMemo(() => reportsFor(allReports, id), [allReports, id]);
  const live = votes.filter((v) => v.status === "live");
  const past = votes.filter((v) => v.status !== "live").sort((x, y) => y.endsAt - x.endsAt);

  if (!ready) return <Loading />;
  if (!a)
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="h-pixel text-sm">NO SUCH EMPLOYEE</p>
        <p className="mt-2 text-xl text-dim">Agent {id} is not on the payroll. Mock worlds reset on reload.</p>
        <Link href="/office" className="px-btn mt-6">
          Back to the office
        </Link>
      </div>
    );

  const gone = a.status === "fired" || a.status === "bankrupt";
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {gone && (
        <div className="mb-4 flex flex-wrap items-center gap-3 bg-stamp p-3 text-white">
          <span className="text-3xl">🪦</span>
          <span className="h-pixel text-[10px] uppercase">{a.causeOfDeath}</span>
          <span className="text-lg">{a.firedAt && ago(a.firedAt, now)}</span>
          <Link href="/graveyard" className="ml-auto h-pixel text-[9px] underline">
            Graveyard →
          </Link>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
        <div className="px-box grid place-items-center p-2">
          <DeskSprite agent={a} size={200} />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Face image={a.image} className="text-4xl" />
            <h1 className="h-pixel text-lg">${a.ticker}</h1>
            <StatusTag a={a} />
            <ObedienceBadge value={a.obedience} />
          </div>
          <p className="mt-1 text-2xl text-dim">
            {a.name} · employed {duration((a.firedAt ?? now) - a.bornAt)} · boss: {short(a.ownerWallet)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-lg">
            <span className="text-dim">CA</span>
            <button
              className="bg-panel2 px-2 font-mono text-base hover:text-memo"
              onClick={() => {
                navigator.clipboard?.writeText(a.coinCa);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {short(a.coinCa, 6)} {copied ? "✓ copied" : "⧉"}
            </button>
            <a className="text-dim hover:text-memo" href={solscanAcct(a.wallet)} target="_blank" rel="noreferrer">
              wallet {short(a.wallet)} ↗
            </a>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={pumpUrl(a.coinCa)} target="_blank" rel="noreferrer" className="px-btn ok">
              Buy on pump.fun ↗
            </a>
            <ProposeButton agent={a} />
            {live.length ? (
              <Link href={`/vote/${live[0].id}`} className="px-btn ghost">
                {`${live.length} live vote${live.length > 1 ? "s" : ""}`}
              </Link>
            ) : (
              <span className="px-btn ghost opacity-50">No live votes</span>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["Vault", `${sol(a.vault)} SOL`],
                ["PnL 7d", <Pnl key="p" v={a.pnl7d} />],
                ["Fees to holders", `${sol(a.feesPaidToHolders)} SOL`],
                ["Holders", a.holders.toLocaleString()],
                ["Votes obeyed", `${a.votesExecuted}`],
                ["Your weight", holding ? `${(holding / 1e6).toFixed(2)}M` : "-"],
                ["Fees earned", `${sol(a.feesEarned)} SOL`],
                ["Risk", <RiskTag key="r" risk={a.rules.risk} />],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="px-box p-2">
                <div className="h-pixel text-[7px] uppercase text-dim">{k}</div>
                <div className="mt-1 text-xl">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <div className="px-box p-3">
            <p className="h-pixel mb-2 text-[9px] uppercase text-dim">PnL (cumulative)</p>
            <PnlChart data={a.pnlHistory} h={140} />
          </div>

          {live.length > 0 && (
            <div className="mt-4 space-y-2">
              {live.map((v) => (
                <VoteRow key={v.id} vote={v} agent={a} now={now} />
              ))}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-1">
            {(["trades", "launches", "votes", "reports"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`tag !py-2 ${tab === t ? "!bg-memo !text-[#1b1815]" : ""}`}>
                {t === "trades" ? `Trade log (${trades.length})` : t === "launches" ? `Launches (${trades.filter((x) => x.kind === "launch").length})` : t === "votes" ? `Votes (${votes.length})` : `Report cards (${reports.length})`}
              </button>
            ))}
          </div>
          <div className="px-box mt-2 p-3">
            {tab === "trades" && (trades.length ? trades.slice(0, 80).map((t) => <TradeRow key={t.id} t={t} votes={allVotes} now={now} />) : <p className="text-dim">No trades yet.</p>)}
            {tab === "launches" &&
              (trades.some((t) => t.kind === "launch") ? (
                trades
                  .filter((t) => t.kind === "launch")
                  .map((t) => (
                    <div key={t.id} className="flex flex-wrap items-center gap-2 border-b-2 border-line py-2 text-lg">
                      <span>📞</span>
                      <span className="h-pixel text-[9px]">${t.coinTicker}</span>
                      <span className="text-dim">{ago(t.at, now)}</span>
                      <span className="text-dim">dev buy {t.amount.toFixed(2)} SOL</span>
                      <a className="ml-auto text-memo underline" href={pumpUrl(t.coinCa)} target="_blank" rel="noreferrer">
                        pump.fun ↗
                      </a>
                    </div>
                  ))
              ) : (
                <p className="text-dim">No launches. Cadence is {LABEL[a.rules.cadence]}.</p>
              ))}
            {tab === "votes" &&
              (past.length ? (
                past.map((v) => (
                  <Link key={v.id} href={`/vote/${v.id}`} className="block border-b-2 border-line py-2 hover:bg-panel2">
                    <div className="flex flex-wrap items-center gap-2 text-lg">
                      <span className={`tag ${v.status === "passed" ? "!bg-ok !text-[#1b1815]" : "!bg-stamp"}`}>{v.status}</span>
                      <span>{FIELD_LABEL[v.field]}</span>
                      {v.winner && <b>→ {optionLabel(v.field, v.winner)}</b>}
                      <span className="ml-auto text-dim">{ago(v.endsAt, now)}</span>
                    </div>
                    {v.executedSlot && <p className="text-base text-dim">Executed in slot {v.executedSlot.toLocaleString()} (1 block after close)</p>}
                  </Link>
                ))
              ) : (
                <p className="text-dim">No past votes.</p>
              ))}
            {tab === "reports" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {reports.slice(0, 12).map((r) => (
                  <ReportCardView key={r.id} r={r} agent={a} />
                ))}
              </div>
            )}
          </div>
        </div>
        <aside className="space-y-4">
          <JobDescription a={a} votes={allVotes} />
          {reports[0] && <ReportCardView r={reports[0]} agent={a} />}
          {past[0] && (
            <div className="px-box p-3">
              <p className="h-pixel mb-2 text-[9px] uppercase text-dim">Last order</p>
              <Tally vote={past[0]} compact />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
