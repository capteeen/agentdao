// Hiring: create the agent record, its wallet, and (live) its pump.fun coin.
//
// live flow:  POST /api/hire {…}         → { id, tx }   server builds the create tx (mint keypair co-signed)
//             user signs + sends          → POST /api/hire/confirm { id, signature }
//             worker reconciles the vault from the agent wallet's balance.
// paper flow: POST /api/hire creates everything at once with a synthetic mint.

import type { Agent, RuleSet } from "../lib/types";
import { LABEL } from "../lib/rules";
import { fakeMint, mulberry32 } from "../lib/util";
import { CFG } from "./config";
import { addEvent, getAgent, getKv, saveAgent, saveKey, setKv } from "./db";
import * as pp from "./pumpportal";
import { Keypair, isPubkey, newAgentKeypair } from "./solana";

export interface HireRequest {
  name: string;
  ticker: string;
  image: string; // data: URL or emoji
  rules: RuleSet;
  devBuySol: number;
  startingVaultSol: number;
  wallet: string; // the boss
}

const nid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function validateHire(h: HireRequest) {
  if (!h.name || h.name.trim().length < 2 || h.name.length > 32) throw new Error("Name must be 2-32 characters");
  if (!/^[A-Z0-9_]{2,10}$/.test(h.ticker)) throw new Error("Ticker must be 2-10 characters A-Z 0-9 _");
  if (!isPubkey(h.wallet)) throw new Error("Invalid wallet");
  if (!(h.startingVaultSol >= 0.1)) throw new Error("Starting vault must be at least 0.1 SOL");
  if (!(h.devBuySol >= 0)) throw new Error("Bad dev buy");
  if (h.rules.strategy === "copytrade" && !(h.rules.copyWallet && isPubkey(h.rules.copyWallet))) throw new Error("Copy-trade needs a wallet to copy");
}

function baseAgent(h: HireRequest, id: string, wallet: string, coinCa: string, now: number): Agent {
  return {
    id,
    name: h.name.trim(),
    ticker: h.ticker,
    image: h.image,
    coinCa,
    wallet,
    vault: CFG.mode === "live" ? 0 : h.startingVaultSol, // live: reconciled from chain after funding
    rules: h.rules,
    ruleSource: { strategy: "hire", risk: "hire", cadence: "hire", takeProfit: "hire", salaryPct: "hire", copyWallet: "hire" },
    pnl7d: 0,
    pnlHistory: [0],
    feesEarned: 0,
    feesPaidToHolders: 0,
    obedience: 100,
    votesExecuted: 0,
    holders: 1,
    supply: CFG.supply,
    bornAt: now,
    status: "working",
    ownerWallet: h.wallet,
    lossStreak: 0,
    seed: Math.floor(Math.random() * 1e9),
  };
}

/** Paper: everything at once. Live: pending record + the create tx for the user to sign. */
export async function hire(h: HireRequest, now = Date.now()): Promise<{ id: string; tx?: string; mint: string; agentWallet: string }> {
  validateHire(h);
  const no = getKv("nextAgentNo", 1);
  setKv("nextAgentNo", no + 1);
  const id = `a${no}`;
  let agentWallet: string;
  if (CFG.keyEncryptionKey) {
    const { keypair, encrypted } = newAgentKeypair();
    agentWallet = keypair.publicKey.toBase58();
    saveKey({ agentId: id, publicKey: agentWallet, encrypted });
  } else {
    if (CFG.mode === "live") throw new Error("BOSS_KEY_ENCRYPTION_KEY required");
    agentWallet = Keypair.generate().publicKey.toBase58(); // paper without a KEK: unfunded throwaway
  }

  if (CFG.mode === "live") {
    const uri = await pp.uploadMetadata({ name: h.name, symbol: h.ticker, description: `${h.name}: an AI trading agent employed by its holders. ${LABEL[h.rules.strategy]} on ${LABEL[h.rules.risk]} risk. Holders vote, it obeys.`, image: await imageBlob(h.image) });
    const { mint, tx } = await pp.buildCreateForUser(h.wallet, { name: h.name, symbol: h.ticker, uri }, h.devBuySol);
    const a = { ...baseAgent(h, id, agentWallet, mint, now), status: "idle" as const };
    saveAgent(a);
    setKv(`pending:${id}`, { createdAt: now });
    return { id, tx, mint, agentWallet };
  }
  const a = baseAgent(h, id, agentWallet, fakeMint(mulberry32(now >>> 0)), now);
  saveAgent(a);
  addEvent({ id: nid("e"), kind: "hired", agentId: id, text: `New hire: $${a.ticker} (${a.name}) joined the floor as a ${LABEL[a.rules.strategy]} on ${LABEL[a.rules.risk]} risk.`, at: now });
  return { id, mint: a.coinCa, agentWallet };
}

/** Live: the user sent the create tx; activate the agent. */
export function confirmHire(id: string, signature: string, now = Date.now()) {
  const a = getAgent(id);
  if (!a) throw new Error("No such agent");
  if (!getKv<{ createdAt: number } | null>(`pending:${id}`, null)) throw new Error("Not pending");
  setKv(`pending:${id}`, null);
  saveAgent({ ...a, status: "working" });
  addEvent({ id: nid("e"), kind: "hired", agentId: id, text: `New hire: $${a.ticker} (${a.name}) launched on pump.fun (tx ${signature.slice(0, 8)}…) and joined the floor.`, at: now });
}

async function imageBlob(image: string): Promise<Blob> {
  if (image.startsWith("data:")) {
    const [head, b64] = image.split(",");
    const type = /data:(.*?);/.exec(head)?.[1] ?? "image/png";
    return new Blob([Buffer.from(b64, "base64")], { type });
  }
  // emoji: a 1x1 placeholder; pump.fun requires some image
  return new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")], { type: "image/png" });
}
