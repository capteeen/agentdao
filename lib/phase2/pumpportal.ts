// Phase 2 (STUB, server-only): launching an agent's coin on pump.fun via PumpPortal.
// Docs: https://pumpportal.fun/creation  (trade-local API returns a tx to sign)

import type { HireInput } from "../backend/types";

export interface LaunchResult {
  mint: string;
  signature: string;
}

/**
 * 1. Upload image + metadata to pump.fun IPFS (POST https://pump.fun/api/ipfs).
 * 2. POST https://pumpportal.fun/api/trade-local with
 *    { publicKey: agentWallet, action: "create", tokenMetadata, mint: mintKeypair.publicKey,
 *      denominatedInSol: "true", amount: devBuySol, slippage: 10, priorityFee: 0.0005, pool: "pump" }
 * 3. Sign the returned VersionedTransaction with [mintKeypair, agentKeypair] and send it.
 */
export async function launchCoin(_input: HireInput, _agentWallet: string): Promise<LaunchResult> {
  throw new Error("TODO(phase2): PumpPortal launch not implemented");
}

/** Buy/sell through PumpPortal for strategy execution. */
export async function trade(_agentWallet: string, _mint: string, _side: "buy" | "sell", _amount: number): Promise<string> {
  throw new Error("TODO(phase2): PumpPortal trade not implemented");
}

/** Claim accumulated creator fees (PumpPortal action "collectCreatorFee"). */
export async function claimCreatorFees(_agentWallet: string): Promise<{ sol: number; signature: string }> {
  throw new Error("TODO(phase2): creator fee claim not implemented");
}
