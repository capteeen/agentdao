"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { useBoss } from "@/lib/store";
import { fakeWallet, mulberry32, short } from "@/lib/util";
import { useMyWallet } from "./Providers";

const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), { ssr: false });

const NAV = [
  ["/office", "Office"],
  ["/leaderboard", "Leaderboard"],
  ["/graveyard", "Graveyard"],
  ["/how", "How"],
  ["/me", "Me"],
] as const;

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { publicKey } = useWallet();
  const demo = useBoss((s) => s.demoWallet);
  if (!publicKey && demo)
    return (
      <button
        className="tag !bg-ok !text-[#1b1815]"
        title="Demo wallet (mock). Click to disconnect."
        onClick={() => {
          useBoss.setState({ demoWallet: null });
          try {
            localStorage.removeItem("boss:demo");
          } catch {}
        }}
      >
        DEMO {short(demo, 3)} ✕
      </button>
    );
  return (
    <div className="flex items-center gap-2">
      <WalletMultiButton />
      {!publicKey && !compact && <DemoWalletLink />}
    </div>
  );
}

export function DemoWalletLink({ className = "" }: { className?: string }) {
  return (
    <button
      className={`text-dim hover:text-memo text-base underline decoration-dotted ${className}`}
      title="No wallet extension? Use a throwaway mock wallet to try voting."
      onClick={() => {
        const w = fakeWallet(mulberry32(Date.now() >>> 0));
        useBoss.setState({ demoWallet: w });
        try {
          localStorage.setItem("boss:demo", w);
        } catch {}
      }}
    >
      or demo wallet
    </button>
  );
}

function Bell() {
  const bell = useBoss((s) => s.bell);
  const [ring, setRing] = useState(false);
  useEffect(() => {
    if (!bell) return;
    setRing(true);
    const t = setTimeout(() => setRing(false), 1200);
    return () => clearTimeout(t);
  }, [bell]);
  return (
    <Link href="/leaderboard" title="Performance review bell: report cards every 24h (every 5 min in mock)" className={`text-xl ${ring ? "shake" : ""}`}>
      🔔
    </Link>
  );
}

export function Header() {
  const path = usePathname();
  const prefs = useBoss((s) => s.prefs);
  const setPrefs = useBoss((s) => s.setPrefs);
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b-4 border-line bg-page/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center bg-memo text-[#1b1815] h-pixel text-[10px]">B</span>
          <span className="h-pixel text-[12px] sm:text-sm">BOSS</span>
        </Link>
        <nav className="ml-4 hidden gap-4 md:flex">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className={`h-pixel text-[9px] uppercase hover:text-memo ${path?.startsWith(href) ? "text-memo" : "text-dim"}`}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Bell />
          <button className="text-xl" title="Toggle 8-bit sounds" onClick={() => setPrefs({ sound: !prefs.sound })}>
            {prefs.sound ? "🔊" : "🔇"}
          </button>
          <button className="text-xl" title="Night mode" onClick={() => setPrefs({ theme: prefs.theme === "dark" ? "light" : "dark" })}>
            {prefs.theme === "dark" ? "🌙" : "☀️"}
          </button>
          <Link href="/hire" className="px-btn memo hidden !py-2 sm:inline-flex">
            Hire
          </Link>
          <div className="hidden sm:block">
            <WalletButton />
          </div>
          <button className="md:hidden h-pixel text-[10px] px-2" onClick={() => setOpen(!open)} aria-label="Menu">
            {open ? "✕" : "☰"}
          </button>
        </div>
      </div>
      {open && (
        <nav className="flex flex-col gap-3 border-t-4 border-line px-4 py-3 md:hidden" onClick={() => setOpen(false)}>
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="h-pixel text-[10px] uppercase">
              {label}
            </Link>
          ))}
          <Link href="/hire" className="h-pixel text-[10px] uppercase text-memo">
            Hire an agent
          </Link>
          <div onClick={(e) => e.stopPropagation()}>
            <WalletButton />
          </div>
        </nav>
      )}
    </header>
  );
}

export function Footer() {
  const backend = useBoss((s) => s.backend);
  return (
    <footer className="mt-16 border-t-4 border-line px-4 py-8 text-center text-dim">
      <p className="mx-auto max-w-2xl text-lg">
        Agents trade and launch on pump.fun (Solana). A meme, not an investment. Crypto is risky. Only use what you can afford to lose.
      </p>
      <p className="mt-3 h-pixel text-[8px] uppercase">
        {backend === "sim" ? "Phase 1 · mock simulator · no real trades" : "Live"} · <Link href="/how" className="link">How it works</Link>
      </p>
    </footer>
  );
}

export function Loading({ label = "Clocking in…" }: { label?: string }) {
  return (
    <div className="grid min-h-[40vh] place-items-center">
      <p className="h-pixel text-[10px] text-dim blink">{label}</p>
    </div>
  );
}
