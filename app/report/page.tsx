import type { Metadata } from "next";
import Link from "next/link";
import { spritePixels } from "@/lib/sprite";

type SP = Record<string, string | undefined>;

export function generateMetadata({ searchParams }: { searchParams: SP }): Metadata {
  const q = new URLSearchParams(Object.entries(searchParams).filter(([, v]) => v !== undefined) as [string, string][]);
  const og = `/api/og/report?${q}`;
  const title = `$${searchParams.t ?? "BOSS"} report card: ${searchParams.g ?? "?"}`;
  return { title, description: `Obedience ${searchParams.o ?? 100}%. Rated by ${searchParams.h ?? 0} holders.`, openGraph: { title, images: [og] }, twitter: { card: "summary_large_image", title, images: [og] } };
}

export default function ReportPage({ searchParams: q }: { searchParams: SP }) {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined) as [string, string][]).toString();
  const pnl = Number(q.p ?? 0);
  const P = 10;
  const tweet = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`$${q.t} got a ${q.g} on its performance review. Obedience ${q.o}%. My employee, my rules.`)}`;
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="memo-card flex flex-col gap-6 p-6 sm:flex-row">
        <div className="relative shrink-0 self-center bg-[#2a2520]" style={{ width: 16 * P, height: 16 * P }}>
          {spritePixels(q.k ?? "working", Number(q.s ?? 0)).map((p, i) => (
            <div key={i} className="absolute" style={{ left: p.x * P, top: p.y * P, width: P, height: P, background: p.c }} />
          ))}
        </div>
        <div className="flex-1">
          <p className="h-pixel text-[8px] uppercase opacity-70">Performance review · {q.d ? new Date(Number(q.d)).toUTCString() : ""}</p>
          <h1 className="h-pixel mt-2 text-lg">${q.t}</h1>
          <p className="text-xl opacity-80">{q.n}</p>
          <div className="mt-3 grid grid-cols-2 text-xl">
            <span>PnL</span>
            <span className={pnl >= 0 ? "text-[#2e8c46]" : "text-[#e63946]"}>{(pnl >= 0 ? "+" : "") + pnl.toFixed(2)} SOL</span>
            <span>Obedience</span>
            <span>{q.o}%</span>
            <span>Fees paid to holders</span>
            <span>{q.f} SOL</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-lg">Rated by {q.h} holders</span>
            <span className="stamp-mark text-2xl">{q.g}</span>
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <a className="px-btn" href={tweet} target="_blank" rel="noreferrer">
          Share on X
        </a>
        <a className="px-btn ghost" href={`/api/og/report?${qs}`} target="_blank" rel="noreferrer">
          OG image ↗
        </a>
        <Link className="px-btn memo" href="/office">
          Visit the office
        </Link>
      </div>
    </div>
  );
}
