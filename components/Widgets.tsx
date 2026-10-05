"use client";

import Face from "@/components/Face";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { selectCounters, useBoss } from "@/lib/store";
import type { Agent, BossEvent, ReportCard, Vote } from "@/lib/types";
import { FIELD_LABEL, LABEL, optionLabel, RISK_COLOR } from "@/lib/rules";
import { ago, countdown, signed, sol } from "@/lib/util";

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ------------------------------------------------------------ odometer

function Digit({ d }: { d: string }) {
  if (!/\d/.test(d)) return <span className="px-[1px]">{d}</span>;
  return (
    <span className="odo-digit">
      <span style={{ transform: `translateY(-${Number(d)}em)` }}>
        {"0123456789".split("").map((x) => (
          <span key={x} style={{ height: "1em" }}>
            {x}
          </span>
        ))}
      </span>
    </span>
  );
}

export function Odometer({ value, decimals = 0, pad = 0 }: { value: number; decimals?: number; pad?: number }) {
  const s = value.toFixed(decimals).padStart(pad, "0");
  return (
    <span className="odo h-pixel">
      {s.split("").map((d, i) => (
        <Digit key={i} d={d} />
      ))}
    </span>
  );
}

export function Counters() {
  const agents = useBoss((s) => s.agents);
  const votes = useBoss((s) => s.votes);
  const c = useMemo(() => selectCounters({ agents, votes }), [agents, votes]);
  const items: [string, number, number][] = [
    ["Agents employed", c.employed, 0],
    ["Votes passed", c.votesPassed, 0],
    ["SOL under mgmt", c.sum, 1],
    ["Agents fired", c.fired, 0],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map(([label, v, d]) => (
        <div key={label} className="px-box p-3 text-center">
          <div className="text-xl sm:text-2xl">
            <Odometer value={v} decimals={d} pad={d ? 6 : 3} />
          </div>
          <div className="mt-2 h-pixel text-[8px] uppercase text-dim">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ ticker

const KIND_COLOR: Record<string, string> = {
  vote_pass: "text-ok",
  vote_open: "text-memo",
  fired: "text-stamp",
  launch: "text-office",
  report: "text-memo",
  hired: "text-ok",
  vote_fail: "text-dim",
  trade: "text-ink",
};

export function Ticker() {
  const events = useBoss((s) => s.events);
  const items = useMemo(() => {
    const important = events.filter((e) => e.kind !== "trade").slice(0, 14);
    const trades = events.filter((e) => e.kind === "trade").slice(0, 6);
    return [...important, ...trades].sort((a, b) => b.at - a.at);
  }, [events]);
  if (!items.length) return <div className="h-10 border-y-4 border-line" />;
  const row = (k: string) =>
    items.map((e) => (
      <Link key={k + e.id} href={e.voteId ? `/vote/${e.voteId}` : `/agent/${e.agentId}`} className={`${KIND_COLOR[e.kind]} hover:underline`}>
        <span className="text-dim">▸</span> {e.text}
      </Link>
    ));
  return (
    <div className="ticker overflow-hidden border-y-4 border-line bg-[#0e0c0a] py-2 text-lg">
      <div className="ticker-track">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ votes

export function Tally({ vote, compact = false }: { vote: Vote; compact?: boolean }) {
  const total = Object.values(vote.tallies).reduce((s, x) => s + x, 0) || 1;
  const quorum = (total / vote.snapshotSupply) * 100;
  const colors = ["#4a90e2", "#d4b82a", "#e63946", "#7bd389"];
  return (
    <div className="space-y-1">
      {vote.options.map((o, i) => {
        const pct = (vote.tallies[o] / total) * 100;
        const win = vote.winner === o;
        return (
          <div key={o} className="flex items-center gap-2">
            <span className={`w-24 shrink-0 truncate ${compact ? "text-base" : "text-lg"} ${win ? "text-ok" : ""}`}>
              {win && "✓ "}
              {optionLabel(vote.field, o)}
            </span>
            <div className="bar flex-1">
              <span style={{ width: `${pct}%`, background: vote.field === "fire" && o === "fire" ? "#e63946" : colors[i % 4] }} />
            </div>
            <span className="w-12 text-right text-base">{pct.toFixed(0)}%</span>
          </div>
        );
      })}
      {!compact && (
        <p className="text-base text-dim">
          Turnout {quorum.toFixed(1)}% of supply · quorum 5% {quorum >= 5 ? "✓" : ""}
        </p>
      )}
    </div>
  );
}

export function VoteRow({ vote, agent, now }: { vote: Vote; agent?: Agent; now: number }) {
  const left = vote.endsAt - now;
  return (
    <Link href={`/vote/${vote.id}`} className="block px-box p-3 hover:brightness-110">
      <div className="mb-2 flex items-center gap-2">
        <Face image={agent?.image} className="text-xl" />
        <span className="h-pixel text-[9px]">${agent?.ticker}</span>
        <span className="tag">{FIELD_LABEL[vote.field]}</span>
        <span className={`ml-auto h-pixel text-[10px] ${left < 15000 ? "text-stamp blink" : "text-memo"}`}>{countdown(left)}</span>
      </div>
      <Tally vote={vote} compact />
    </Link>
  );
}

export function VoteClosingPanel({ limit = 5, agentId }: { limit?: number; agentId?: string }) {
  const votes = useBoss((s) => s.votes);
  const agents = useBoss((s) => s.agents);
  const now = useNow(500);
  const live = votes
    .filter((v) => v.status === "live" && (!agentId || v.agentId === agentId))
    .sort((a, b) => a.endsAt - b.endsAt)
    .slice(0, limit);
  return (
    <div>
      <h3 className="h-pixel mb-3 flex items-center gap-2 text-[11px] uppercase">
        <span className="inline-block h-3 w-3 bg-stamp blink" /> Vote closing
      </h3>
      {live.length === 0 ? (
        <p className="text-dim">No live votes. The board is at lunch.</p>
      ) : (
        <div className="space-y-2">
          {live.map((v) => (
            <VoteRow key={v.id} vote={v} agent={agents.find((a) => a.id === v.agentId)} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ badges / small bits

export function ObedienceBadge({ value }: { value: number }) {
  return (
    <span className="tag !bg-ok !text-[#1b1815]" title="% of passed votes executed within 1 block">
      OBEDIENCE {value.toFixed(0)}%
    </span>
  );
}

export function RiskTag({ risk }: { risk: Agent["rules"]["risk"] }) {
  return (
    <span className="tag" style={{ background: RISK_COLOR[risk], color: "#1b1815" }}>
      {LABEL[risk]}
    </span>
  );
}

export function StatusTag({ a }: { a: Agent }) {
  const map = { working: ["bg-ok", "EMPLOYED"], idle: ["bg-dim", "ASLEEP"], fired: ["bg-stamp", "FIRED"], bankrupt: ["bg-stamp", "BANKRUPT"] } as const;
  const [bg, t] = map[a.status];
  return <span className={`tag ${bg} !text-[#1b1815]`}>{t}</span>;
}

export function Pnl({ v, className = "" }: { v: number; className?: string }) {
  return <span className={`${v >= 0 ? "text-ok" : "text-stamp"} ${className}`}>{signed(v)} SOL</span>;
}

/** Pixel-stepped PnL line (SVG, crisp edges). */
export function PnlChart({ data, h = 120 }: { data: number[]; h?: number }) {
  const W = 300;
  if (data.length < 2) return <div className="grid place-items-center text-dim" style={{ height: h }}>No trades yet</div>;
  const min = Math.min(0, ...data),
    max = Math.max(0, ...data);
  const span = max - min || 1;
  const step = W / (data.length - 1);
  const y = (v: number) => Math.round(((max - v) / span) * (h - 8) + 4);
  let d = `M0 ${y(data[0])}`;
  data.forEach((v, i) => {
    if (i === 0) return;
    const x = Math.round(i * step);
    d += ` H${x} V${y(v)}`;
  });
  const last = data[data.length - 1];
  const color = last >= 0 ? "#7bd389" : "#e63946";
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="w-full" style={{ height: h }} preserveAspectRatio="none" shapeRendering="crispEdges">
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="rgb(var(--line))" strokeWidth="2" strokeDasharray="4 4" />
      <path d={d} fill="none" stroke={color} strokeWidth="4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function EventLine({ e, now }: { e: BossEvent; now: number }) {
  return (
    <div className="flex gap-2 text-lg">
      <span className="w-16 shrink-0 text-dim">{ago(e.at, now)}</span>
      <Link href={e.voteId ? `/vote/${e.voteId}` : `/agent/${e.agentId}`} className={`${KIND_COLOR[e.kind]} hover:underline`}>
        {e.text}
      </Link>
    </div>
  );
}

export function ReportCardView({ r, agent, share = true }: { r: ReportCard; agent?: Agent; share?: boolean }) {
  const shareUrl = useMemo(() => {
    if (!agent) return "";
    const q = new URLSearchParams({
      n: agent.name,
      t: agent.ticker,
      i: agent.image,
      p: r.pnl.toFixed(2),
      o: String(r.obedience),
      f: r.feesPaid.toFixed(2),
      h: String(r.raters),
      g: r.grade,
      s: String(agent.seed),
      d: String(r.at),
      k: agent.status,
    });
    return `/report?${q}`;
  }, [r, agent]);
  return (
    <div className="memo-card p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="h-pixel text-[8px] uppercase opacity-70">Performance review</p>
          <p className="h-pixel mt-1 text-[11px]">
            <Face image={agent?.image} /> ${agent?.ticker}
          </p>
          <p className="text-base opacity-70">{new Date(r.at).toLocaleString()}</p>
        </div>
        <div className="h-pixel text-3xl" style={{ color: r.grade.startsWith("A") ? "#2e8c46" : r.grade === "F" ? "#e63946" : "#1b1815" }}>
          {r.grade}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 text-lg">
        <span>PnL (24h)</span>
        <span className={`text-right ${r.pnl >= 0 ? "text-[#2e8c46]" : "text-[#e63946]"}`}>{signed(r.pnl)} SOL</span>
        <span>Obedience</span>
        <span className="text-right">{r.obedience}%</span>
        <span>Fees to holders</span>
        <span className="text-right">{sol(r.feesPaid)} SOL</span>
        <span>Trades</span>
        <span className="text-right">{r.trades}</span>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-base">Rated by {r.raters} holders</span>
        {share && shareUrl && (
          <Link href={shareUrl} className="h-pixel text-[8px] underline">
            SHARE ↗
          </Link>
        )}
      </div>
    </div>
  );
}
