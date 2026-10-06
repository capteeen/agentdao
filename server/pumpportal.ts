// PumpPortal: transaction building (trade-local) and the market data feed.
// Docs: https://pumpportal.fun/trading-api/ and /data-api/real-time
//
// trade-local returns an unsigned VersionedTransaction; we sign with the agent
// keypair (or the hiring user's wallet for `create`) and send it ourselves.

import { Keypair, VersionedTransaction } from "@solana/web3.js";
import WebSocket from "ws";
import { connection } from "./solana";

const TRADE_LOCAL = "https://pumpportal.fun/api/trade-local";
const IPFS = "https://pump.fun/api/ipfs";
export const DATA_WS = "wss://pumpportal.fun/api/data";

export interface TradeParams {
  publicKey: string;
  action: "buy" | "sell" | "create" | "collectCreatorFee";
  mint?: string;
  amount?: number | string; // SOL for buy (denominatedInSol true) or tokens / "100%" for sell
  denominatedInSol?: "true" | "false";
  slippage?: number;
  priorityFee?: number;
  pool?: "pump" | "auto";
  tokenMetadata?: { name: string; symbol: string; uri: string };
}

/** Build an unsigned transaction via trade-local. */
export async function buildTx(p: TradeParams): Promise<VersionedTransaction> {
  const res = await fetch(TRADE_LOCAL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slippage: 10, priorityFee: 0.0005, pool: "pump", ...p }) });
  if (!res.ok) throw new Error(`PumpPortal ${res.status}: ${await res.text()}`);
  return VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));
}

/** Upload image + metadata to pump.fun IPFS; returns the metadata URI. */
export async function uploadMetadata(m: { name: string; symbol: string; description: string; image: Blob; twitter?: string; website?: string }): Promise<string> {
  const form = new FormData();
  form.append("file", m.image, "image.png");
  form.append("name", m.name);
  form.append("symbol", m.symbol);
  form.append("description", m.description);
  form.append("showName", "true");
  if (m.twitter) form.append("twitter", m.twitter);
  if (m.website) form.append("website", m.website);
  const res = await fetch(IPFS, { method: "POST", body: form });
  if (!res.ok) throw new Error(`IPFS upload ${res.status}`);
  const j = (await res.json()) as { metadataUri: string };
  return j.metadataUri;
}

export async function signAndSend(tx: VersionedTransaction, signers: Keypair[]): Promise<string> {
  tx.sign(signers);
  const sig = await connection().sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection().confirmTransaction(sig, "confirmed");
  return sig;
}

/** Buy `sol` worth of `mint` with the agent key. Returns the signature. */
export async function buy(agent: Keypair, mint: string, sol: number) {
  const tx = await buildTx({ publicKey: agent.publicKey.toBase58(), action: "buy", mint, amount: sol, denominatedInSol: "true" });
  return signAndSend(tx, [agent]);
}
/** Sell `pct`% (default all) of `mint`. */
export async function sell(agent: Keypair, mint: string, pct = 100) {
  const tx = await buildTx({ publicKey: agent.publicKey.toBase58(), action: "sell", mint, amount: `${pct}%`, denominatedInSol: "false" });
  return signAndSend(tx, [agent]);
}
/** Create a coin with the agent as creator (so creator fees accrue to the agent wallet). */
export async function create(agent: Keypair, meta: { name: string; symbol: string; uri: string }, devBuySol: number) {
  const mint = Keypair.generate();
  const tx = await buildTx({ publicKey: agent.publicKey.toBase58(), action: "create", tokenMetadata: meta, mint: mint.publicKey.toBase58(), amount: devBuySol, denominatedInSol: "true" });
  const sig = await signAndSend(tx, [mint, agent]);
  return { mint: mint.publicKey.toBase58(), sig };
}
/** Build the create tx for a *user* wallet to sign (hire flow): the agent key co-signs as the mint authority holder is the mint keypair. */
export async function buildCreateForUser(userWallet: string, meta: { name: string; symbol: string; uri: string }, devBuySol: number) {
  const mint = Keypair.generate();
  const tx = await buildTx({ publicKey: userWallet, action: "create", tokenMetadata: meta, mint: mint.publicKey.toBase58(), amount: devBuySol, denominatedInSol: "true" });
  tx.sign([mint]); // partial: user signs the rest client-side
  return { mint: mint.publicKey.toBase58(), tx: Buffer.from(tx.serialize()).toString("base64") };
}
export async function collectCreatorFee(agent: Keypair) {
  const tx = await buildTx({ publicKey: agent.publicKey.toBase58(), action: "collectCreatorFee", priorityFee: 0.000001 });
  return signAndSend(tx, [agent]);
}

// ---------------------------------------------------------------- data feed

export interface FeedTrade {
  kind: "trade";
  mint: string;
  ticker?: string;
  trader: string;
  isBuy: boolean;
  sol: number;
  tokens: number;
  /** SOL per token after the trade (from virtual reserves). */
  price: number;
  marketCapSol?: number;
  at: number;
}
export interface FeedLaunch {
  kind: "launch";
  mint: string;
  ticker: string;
  name: string;
  creator: string;
  devBuySol: number;
  price: number;
  at: number;
}
export type FeedEvent = FeedTrade | FeedLaunch;

/** Normalise a PumpPortal message into a FeedEvent (exported for tests). */
export function parseFeedMessage(m: Record<string, unknown>, at = Date.now()): FeedEvent | null {
  const num = (x: unknown) => (typeof x === "number" ? x : Number(x ?? 0));
  const vSol = num(m.vSolInBondingCurve),
    vTok = num(m.vTokensInBondingCurve);
  const price = vTok > 0 ? vSol / vTok : 0;
  if (m.txType === "create") {
    return { kind: "launch", mint: String(m.mint), ticker: String(m.symbol ?? "").toUpperCase(), name: String(m.name ?? ""), creator: String(m.traderPublicKey ?? ""), devBuySol: num(m.solAmount), price, at };
  }
  if (m.txType === "buy" || m.txType === "sell") {
    return { kind: "trade", mint: String(m.mint), trader: String(m.traderPublicKey ?? ""), isBuy: m.txType === "buy", sol: num(m.solAmount), tokens: num(m.tokenAmount), price, marketCapSol: num(m.marketCapSol), at };
  }
  return null;
}

/** Live feed with reconnect. Subscribes to new tokens, plus mints / wallets on demand. */
export class PumpFeed {
  private ws: WebSocket | null = null;
  private mints = new Set<string>();
  private wallets = new Set<string>();
  private stopped = false;
  constructor(private onEvent: (e: FeedEvent) => void, private url = DATA_WS) {}

  start() {
    this.stopped = false;
    this.connect();
  }
  stop() {
    this.stopped = true;
    this.ws?.close();
  }
  private connect() {
    if (this.stopped) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on("open", () => {
      ws.send(JSON.stringify({ method: "subscribeNewToken" }));
      if (this.mints.size) ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [...this.mints] }));
      if (this.wallets.size) ws.send(JSON.stringify({ method: "subscribeAccountTrade", keys: [...this.wallets] }));
    });
    ws.on("message", (raw) => {
      try {
        const e = parseFeedMessage(JSON.parse(raw.toString()));
        if (e) this.onEvent(e);
      } catch {}
    });
    ws.on("close", () => !this.stopped && setTimeout(() => this.connect(), 2000));
    ws.on("error", () => ws.close());
  }
  watchMint(mint: string) {
    if (this.mints.has(mint)) return;
    this.mints.add(mint);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
  }
  unwatchMint(mint: string) {
    if (!this.mints.delete(mint)) return;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [mint] }));
  }
  watchWallet(w: string) {
    if (this.wallets.has(w)) return;
    this.wallets.add(w);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ method: "subscribeAccountTrade", keys: [w] }));
  }
}
