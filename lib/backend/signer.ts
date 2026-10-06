"use client";

// Who signs on the client. A connected wallet adapter, or a local throwaway
// keypair ("demo wallet") that can still produce real ed25519 signatures so
// the server treats both the same way.

import { Keypair, type VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

export interface Signer {
  address: string;
  signMessage(msg: string): Promise<string>; // base58 signature
  signTransaction?(tx: VersionedTransaction): Promise<VersionedTransaction>;
  isDemo: boolean;
}

let current: Signer | null = null;
export const setSigner = (s: Signer | null) => (current = s);
export const getSigner = () => current;

const DEMO_KEY = "boss:demo:secret";

/** Load or create the local demo keypair. */
export function demoKeypair(): Keypair {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) return Keypair.fromSecretKey(bs58.decode(raw));
  } catch {}
  const kp = Keypair.generate();
  try {
    localStorage.setItem(DEMO_KEY, bs58.encode(kp.secretKey));
  } catch {}
  return kp;
}

export function demoSigner(kp = demoKeypair()): Signer {
  return {
    address: kp.publicKey.toBase58(),
    isDemo: true,
    async signMessage(msg) {
      return bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey));
    },
    async signTransaction(tx) {
      tx.sign([kp]);
      return tx;
    },
  };
}

export function adapterSigner(publicKey: string, signMessage: (m: Uint8Array) => Promise<Uint8Array>, signTransaction?: <T extends VersionedTransaction>(t: T) => Promise<T>): Signer {
  return {
    address: publicKey,
    isDemo: false,
    async signMessage(msg) {
      return bs58.encode(await signMessage(new TextEncoder().encode(msg)));
    },
    signTransaction: signTransaction ? (tx) => signTransaction(tx) : undefined,
  };
}
