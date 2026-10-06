// Solana primitives: RPC connection, agent keypairs (encrypted at rest),
// ballot signatures, holder snapshots, bonding-curve pricing, fee-tx checks.

import { Connection, Keypair, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import crypto from "node:crypto";
import { CFG } from "./config";

export const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const LAMPORTS = 1_000_000_000;

let conn: Connection | null = null;
export function connection() {
  return (conn ??= new Connection(CFG.rpc, { commitment: "confirmed" }));
}

// ---------------------------------------------------------------- keys

function kek() {
  if (!/^[0-9a-f]{64}$/i.test(CFG.keyEncryptionKey)) throw new Error("BOSS_KEY_ENCRYPTION_KEY (32 bytes hex) is required to handle agent keys");
  return Buffer.from(CFG.keyEncryptionKey, "hex");
}

/** AES-256-GCM. Output: iv:tag:ciphertext (hex). */
export function encryptSecret(secret: Uint8Array): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", kek(), iv);
  const enc = Buffer.concat([c.update(Buffer.from(secret)), c.final()]);
  return [iv.toString("hex"), c.getAuthTag().toString("hex"), enc.toString("hex")].join(":");
}
export function decryptSecret(blob: string): Uint8Array {
  const [iv, tag, enc] = blob.split(":").map((h) => Buffer.from(h, "hex"));
  const d = crypto.createDecipheriv("aes-256-gcm", kek(), iv);
  d.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([d.update(enc), d.final()]));
}

export function newAgentKeypair(): { keypair: Keypair; encrypted: string } {
  const keypair = Keypair.generate();
  return { keypair, encrypted: encryptSecret(keypair.secretKey) };
}
export const keypairFrom = (encrypted: string) => Keypair.fromSecretKey(decryptSecret(encrypted));

// ---------------------------------------------------------------- signed messages (ballots, ratings)

export const ballotMessage = (voteId: string, option: string) => `BOSS vote ${voteId} ${option}`;
export const ratingMessage = (reportId: string, up: boolean) => `BOSS rate ${reportId} ${up ? "up" : "down"}`;

/** Verify an ed25519 signature (base58) over a UTF-8 message by a base58 pubkey. */
export function verifySigned(message: string, signature: string, wallet: string): boolean {
  try {
    return nacl.sign.detached.verify(new TextEncoder().encode(message), bs58.decode(signature), bs58.decode(wallet));
  } catch {
    return false;
  }
}
/** Sign with a Keypair (tests, and the agent's own attestations). */
export function signMessage(message: string, kp: Keypair): string {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
}

export function isPubkey(s: string) {
  try {
    new PublicKey(s);
    return s.length >= 32;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- balances / snapshots

/** Raw token amount of `mint` held by `owner` (sums all token accounts). */
export async function balanceOf(mint: string, owner: string): Promise<number> {
  const res = await connection().getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) });
  let total = 0;
  for (const a of res.value) total += Number(a.account.data.parsed.info.tokenAmount.amount);
  return total;
}

export async function tokenSupply(mint: string): Promise<number> {
  const s = await connection().getTokenSupply(new PublicKey(mint));
  return Number(s.value.amount);
}

export async function solBalance(pubkey: string): Promise<number> {
  return (await connection().getBalance(new PublicKey(pubkey))) / LAMPORTS;
}

/**
 * Full holder snapshot of a mint via getProgramAccounts on the token program
 * (dataSize 165, mint at offset 0). Works on any standard RPC; no DAS needed.
 * Excludes `exclude` owners (the bonding curve, the agent's own wallet).
 */
export async function snapshotHolders(mint: string, exclude: string[] = []): Promise<{ slot: number; balances: Record<string, number> }> {
  const c = connection();
  const slot = await c.getSlot("confirmed");
  const accounts = await c.getParsedProgramAccounts(TOKEN_PROGRAM, {
    commitment: "confirmed",
    filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint } }],
  });
  const balances: Record<string, number> = {};
  const skip = new Set(exclude);
  for (const a of accounts) {
    const data = a.account.data as { parsed?: { info?: { owner?: string; tokenAmount?: { amount?: string } } } };
    const owner = data.parsed?.info?.owner;
    const amt = Number(data.parsed?.info?.tokenAmount?.amount ?? 0);
    if (!owner || !amt || skip.has(owner)) continue;
    balances[owner] = (balances[owner] ?? 0) + amt;
  }
  return { slot, balances };
}

// ---------------------------------------------------------------- bonding curve

export interface CurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

export function bondingCurvePda(mint: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP_PROGRAM)[0];
}

/** Decode a pump.fun BondingCurve account (8-byte discriminator, 5×u64 LE, bool). */
export function decodeCurve(data: Buffer | Uint8Array): CurveState {
  const b = Buffer.from(data);
  if (b.length < 49) throw new Error("bonding curve account too short");
  const u = (o: number) => b.readBigUInt64LE(o);
  return { virtualTokenReserves: u(8), virtualSolReserves: u(16), realTokenReserves: u(24), realSolReserves: u(32), tokenTotalSupply: u(40), complete: b[48] === 1 };
}

/** Spot price in SOL per whole token (6 decimals). */
export function curvePrice(c: CurveState): number {
  const sol = Number(c.virtualSolReserves) / LAMPORTS;
  const tok = Number(c.virtualTokenReserves) / 10 ** CFG.decimals;
  return tok > 0 ? sol / tok : 0;
}

/** Constant-product quote: tokens out for `sol` in (before the 1% fee). */
export function quoteBuy(c: CurveState, sol: number): number {
  const x = Number(c.virtualSolReserves) / LAMPORTS;
  const y = Number(c.virtualTokenReserves) / 10 ** CFG.decimals;
  const k = x * y;
  return y - k / (x + sol);
}
/** SOL out for `tokens` in. */
export function quoteSell(c: CurveState, tokens: number): number {
  const x = Number(c.virtualSolReserves) / LAMPORTS;
  const y = Number(c.virtualTokenReserves) / 10 ** CFG.decimals;
  const k = x * y;
  return x - k / (y + tokens);
}

export async function fetchCurve(mint: string): Promise<CurveState | null> {
  const info = await connection().getAccountInfo(bondingCurvePda(mint), "confirmed");
  return info ? decodeCurve(info.data) : null;
}

// ---------------------------------------------------------------- fee transfer verification

/**
 * Check that `signature` is a confirmed tx where `from` sent at least `minSol`
 * to `to`. Used for proposal fees (holder → agent vault).
 */
export async function verifyTransfer(signature: string, from: string, to: string, minSol: number): Promise<boolean> {
  const tx = await connection().getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx || tx.meta?.err) return false;
  return transferAmount(tx, from, to) >= minSol - 1e-9;
}

/** Pure helper (testable): lamports moved from `from` to `to`, in SOL. */
export function transferAmount(tx: ParsedTransactionWithMeta, from: string, to: string): number {
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  const fi = keys.indexOf(from),
    ti = keys.indexOf(to);
  if (fi < 0 || ti < 0 || !tx.meta) return 0;
  const gained = (tx.meta.postBalances[ti] - tx.meta.preBalances[ti]) / LAMPORTS;
  const paid = (tx.meta.preBalances[fi] - tx.meta.postBalances[fi]) / LAMPORTS;
  return paid > 0 ? gained : 0;
}

export const toBase58 = (k: PublicKey) => k.toBase58();
export { Keypair, PublicKey };
