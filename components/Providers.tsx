"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import "@solana/wallet-adapter-react-ui/styles.css";
import { backend } from "@/lib/backend";
import { adapterSigner, demoKeypair, demoSigner, setSigner } from "@/lib/backend/signer";
import { useBoss } from "@/lib/store";
import { sfx } from "./sound";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";

/** Create a throwaway mock wallet so a visitor can vote right away. */
export function startDemoWallet(holdAgentId?: string) {
  // A real local keypair: it can sign ballots, so the server treats it like any wallet.
  const w = demoKeypair().publicKey.toBase58();
  const s = useBoss.getState();
  // A first-time visitor who clicks a vote gets a stake in that agent so the
  // first order always counts (0.5% of supply).
  const forced = holdAgentId && s.agents[holdAgentId] ? { [holdAgentId]: Math.floor(s.agents[holdAgentId].supply * 0.005) } : {};
  useBoss.setState({ demoWallet: w, holdings: { ...s.holdings, ...forced } });
  try {
    localStorage.setItem("boss:demo", w);
  } catch {}
  useBoss.getState().toast({ kind: "info", text: "Demo wallet created. You now hold a few agents. Give one an order.", href: "/me" });
  return w;
}

/** The address we act as: a connected wallet, or the demo wallet. */
export function useMyWallet() {
  const { publicKey } = useWallet();
  const demo = useBoss((s) => s.demoWallet);
  const address = publicKey?.toBase58() ?? demo ?? null;
  return { address, connected: !!address, isDemo: !publicKey && !!demo, ensure: (holdAgentId?: string) => address ?? startDemoWallet(holdAgentId) };
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

/** Keep the backend's signer in sync with the wallet adapter / demo wallet. */
function SignerSync() {
  const { publicKey, signMessage, signTransaction } = useWallet();
  const demo = useBoss((s) => s.demoWallet);
  useEffect(() => {
    if (publicKey && signMessage) setSigner(adapterSigner(publicKey.toBase58(), signMessage, signTransaction));
    else if (demo) setSigner(demoSigner());
    else setSigner(null);
  }, [publicKey, signMessage, signTransaction, demo]);
  return null;
}

/** Voting weight = token balance snapshot. Refresh when the wallet changes. */
function HoldingsSync() {
  const { address } = useMyWallet();
  const ready = useBoss((s) => s.ready);
  const n = useBoss((s) => Object.keys(s.agents).length);
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

/** 8-bit sounds for world events. On by default, but browsers only allow
 *  audio after the first user gesture, so we arm on the first click/tap. */
function SoundFx() {
  const soundPref = useBoss((s) => s.prefs.sound);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const arm = () => setArmed(true);
    window.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, []);
  const sound = soundPref && armed;
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
          <SignerSync />
          <HoldingsSync />
          <ThemeSync />
          <SoundFx />
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
