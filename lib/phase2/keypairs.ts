// Phase 2 (STUB, server-only): one Solana keypair per agent.
//
// Never ship this file to the client. Keys are generated server-side,
// encrypted with a KMS data key (or libsodium sealed box with
// BOSS_KEY_ENCRYPTION_KEY) and stored next to the agent row. Only the
// executor process decrypts them, and only to sign txs that the rule engine
// produced from the agent's current, vote-approved rule set.

export interface AgentKey {
  agentId: string;
  publicKey: string;
  encryptedSecret: string;
}

export async function createAgentKeypair(_agentId: string): Promise<AgentKey> {
  // import { Keypair } from "@solana/web3.js"; const kp = Keypair.generate(); encrypt(kp.secretKey)
  throw new Error("TODO(phase2): keypair generation + encryption");
}

export async function withAgentSigner<T>(_agentId: string, _fn: (signer: unknown) => Promise<T>): Promise<T> {
  throw new Error("TODO(phase2): decrypt + sign");
}
