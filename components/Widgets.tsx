"use client";

import Face from "@/components/Face";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { selectCounters, useAgents, useBoss, useVotes } from "@/lib/store";
import type { Agent, BossEvent, ReportCard, Vote } from "@/lib/types";
import { FIELD_LABEL, LABEL, optionLabel, RISK_COLOR } from "@/lib/rules";
import { SIM } from "@/lib/sim";
import { backend } from "@/lib/backend";
import { ago, countdown as rawCountdown, signed, sol } from "@/lib/util";
import { useMyWallet } from "./Providers";

/** Countdown honouring the office-clock preference (1 mock s = 40 real s). */
export function useCountdown() {
  const office = useBoss((s) => s.prefs.officeClock);
  return (ms: number) => (office ? rawCountdown(ms * SIM.CLOCK) : rawCountdown(ms));
}

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
  const agents = useAgents();
  const votes = useVotes();
  const c = useMemo(() => selectCounters(agents, votes), [agents, votes]);
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
  gossip: "text-dim italic",
  payout: "text-ok",
};

export function Ticker() {
  const events = useBoss((s) => s.events);
  const items = useMemo(() => {
    const important = events.filter((e) => e.kind !== "trade" && e.kind !== "gossip").slice(0, 14);
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
  const countdown = useCountdown();
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
  const votes = useVotes();
  const agentMap = useBoss((s) => s.agents);
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
            <VoteRow key={v.id} vote={v} agent={agentMap[v.agentId]} now={now} />
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
  const mine = useBoss((s) => s.myRatings[r.id]);
  const { address } = useMyWallet();
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
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-base">
          Rated by {r.raters} holders
          <span className="ml-2 inline-flex gap-1">
            <button
              className={`px-1 ${mine === true ? "bg-[#2e8c46] text-white" : "bg-[#1b1815]/10"}`}
              title={address ? "Good employee" : "Connect a wallet to rate"}
              disabled={mine !== undefined || !address}
              onClick={() => backend.rate(r.id, true)}
            >
              👍 {r.up}
            </button>
            <button
              className={`px-1 ${mine === false ? "bg-[#e63946] text-white" : "bg-[#1b1815]/10"}`}
              title={address ? "Bad employee" : "Connect a wallet to rate"}
              disabled={mine !== undefined || !address}
              onClick={() => backend.rate(r.id, false)}
            >
              👎 {r.down}
            </button>
          </span>
        </span>
        {share && shareUrl && (
          <Link href={shareUrl} className="h-pixel text-[8px] underline">
            SHARE ↗
          </Link>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ toasts

export function Toasts() {
  const toasts = useBoss((s) => s.toasts);
  const dismiss = useBoss((s) => s.dismissToast);
  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => dismiss(toasts[0].id), 7000);
    return () => clearTimeout(t);
  }, [toasts, dismiss]);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
      {toasts.map((t) => (
        <Link key={t.id} href={t.href ?? "#"} onClick={() => dismiss(t.id)} className={`toast pointer-events-auto max-w-lg px-4 py-2 text-lg ${t.kind === "payout" ? "px-box !bg-ok text-[#1b1815]" : "memo-card"}`}>
          <span className="h-pixel mr-2 text-[8px] uppercase">{t.kind === "obeyed" ? "Obeyed" : t.kind === "payout" ? "Payday" : "Memo"}</span>
          {t.text}
        </Link>
      ))}
    </div>
  );
}

/** The office gossip column. */
export function Watercooler({ limit = 8 }: { limit?: number }) {
  const events = useBoss((s) => s.events);
  const now = useNow(5000);
  const items = useMemo(() => events.filter((e) => e.kind === "gossip").slice(0, limit), [events, limit]);
  return (
    <div>
      <h3 className="h-pixel mb-3 text-[11px] uppercase">🚰 Watercooler</h3>
      <div className="px-box space-y-1 p-3">
        {items.map((e) => (
          <EventLine key={e.id} e={e} now={now} />
        ))}
        {!items.length && <p className="text-dim">Quiet. Suspiciously quiet.</p>}
      </div>
    </div>
  );
}

/** Home: the soonest-closing vote with one-click orders. First thing a visitor does. */
export function FirstOrder() {
  const votes = useVotes();
  const agentMap = useBoss((s) => s.agents);
  const myVotes = useBoss((s) => s.myVotes);
  const { ensure } = useMyWallet();
  const now = useNow(500);
  const countdown = useCountdown();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const v = useMemo(() => votes.filter((x) => x.status === "live" && x.endsAt - now > 3000 && !myVotes[x.id]).sort((a, b) => a.endsAt - b.endsAt)[0], [votes, now, myVotes]);
  const a = v ? agentMap[v.agentId] : undefined;
  if (!v || !a) return null;
  const cast = async (opt: string) => {
    const who = ensure(a.id);
    setBusy(opt);
    setErr("");
    try {
      await backend.vote(v.id, opt, who);
      useBoss.getState().toast({ kind: "info", text: `Order placed on $${a.ticker}. Watch the boardroom: the memo flies when it closes.`, href: `/vote/${v.id}` });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="memo-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="h-pixel text-[8px] uppercase">Give your first order</p>
        <span className="h-pixel text-[10px]">{countdown(v.endsAt - now)}</span>
      </div>
      <p className="mt-2 text-xl">
        <Face image={a.image} /> ${a.ticker}: {FIELD_LABEL[v.field].toLowerCase()}?
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {v.options.map((o) => (
          <button key={o} className={`px-btn !py-2 text-[9px] ${o === "fire" ? "stamp" : ""}`} disabled={!!busy} onClick={() => cast(o)}>
            {busy === o ? "…" : optionLabel(v.field, o)}
          </button>
        ))}
      </div>
      {err && <p className="mt-1 text-lg text-[#e63946]">{err}</p>}
      <p className="mt-2 text-base opacity-70">One click. No wallet needed to try: a demo wallet is created for you. Then watch the agent obey.</p>
    </div>
  );
}
