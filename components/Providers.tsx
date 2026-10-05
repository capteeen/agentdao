"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { ConnectionProvider as CP, WalletProvider as WP, useWallet } from "@solana/wallet-adapter-react";
import type { Adapter } from "@solana/wallet-adapter-base";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import "@solana/wallet-adapter-react-ui/styles.css";
import { backend } from "@/lib/backend";
import { useBoss } from "@/lib/store";
import { sfx } from "./sound";

// wallet-adapter-react pulls a nested @types/react@19 (via react-native); re-type for React 18.
const ConnectionProvider = CP as unknown as (p: { endpoint: string; children: ReactNode }) => JSX.Element;
const WalletProvider = WP as unknown as (p: { wallets: Adapter[]; autoConnect?: boolean; children: ReactNode }) => JSX.Element;

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";

/** The address we act as: a connected wallet, or the demo wallet. */
export function useMyWallet() {
  const { publicKey } = useWallet();
  const demo = useBoss((s) => s.demoWallet);
  const address = publicKey?.toBase58() ?? demo ?? null;
  return { address, connected: !!address, isDemo: !publicKey && !!demo };
}

function SimRunner() {
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("boss:prefs") ?? "null");
      if (p) useBoss.setState({ prefs: { ...useBoss.getState().prefs, ...p } });
      const demo = localStorage.getItem("boss:demo");
      if (demo) useBoss.setState({ demoWallet: demo });
    } catch {}
    return backend.start();
  }, []);
  return null;
}

/** Voting weight = token balance snapshot. Refresh when the wallet changes. */
function HoldingsSync() {
  const { address } = useMyWallet();
  const ready = useBoss((s) => s.ready);
  const n = useBoss((s) => s.agents.length);
  useEffect(() => {
    if (!ready) return;
    if (!address) {
      useBoss.setState({ holdings: {} });
      return;
    }
    backend.holdings(address).then((h) => useBoss.setState((s) => ({ holdings: { ...h, ...pickOwned(s.holdings, h) } })));
  }, [address, ready, n]);
  return null;
}
const pickOwned = (prev: Record<string, number>, next: Record<string, number>) => Object.fromEntries(Object.entries(prev).filter(([k]) => !(k in next)));

function ThemeSync() {
  const theme = useBoss((s) => s.prefs.theme);
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);
  return null;
}

/** 8-bit sounds for world events (when enabled). */
function SoundFx() {
  const sound = useBoss((s) => s.prefs.sound);
  const top = useBoss((s) => s.events[0]?.id);
  const bell = useBoss((s) => s.bell);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!sound || !top) return;
    const e = useBoss.getState().events[0];
    if (!e) return;
    if (e.kind === "trade") sfx.key();
    else if (e.kind === "launch") sfx.phone();
    else if (e.kind === "vote_pass") setTimeout(sfx.stamp, 1600);
    else if (e.kind === "fired") setTimeout(sfx.box, 1600);
    else if (e.kind === "vote_open") sfx.click();
  }, [top, sound]);
  useEffect(() => {
    if (sound && bell) sfx.bell();
  }, [bell, sound]);
  return null;
}

export default function Providers({ children }: { children: ReactNode }) {
  // Phantom + Solflare adapters are listed explicitly; Backpack (and any other
  // Wallet Standard wallet) is auto-detected by the provider.
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <SimRunner />
          <HoldingsSync />
          <ThemeSync />
          <SoundFx />
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
