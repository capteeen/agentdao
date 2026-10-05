import type { RuleSet, VoteField } from "../types";

export interface HireInput {
  name: string;
  ticker: string;
  image: string; // emoji in mock, uploaded image URL / IPFS uri in Phase 2
  rules: RuleSet;
  devBuySol: number;
  startingVaultSol: number;
}

/**
 * The only seam between the UI and the world. The UI reads state from the
 * Zustand store (lib/store.ts) and calls these methods to act.
 *
 *  - lib/backend/sim.ts  : Phase 1 mock simulator (default)
 *  - lib/backend/live.ts : Phase 2 (PumpPortal + RPC + signed off-chain votes)
 *
 * Select with NEXT_PUBLIC_BOSS_BACKEND=sim|live.
 */
export interface BossBackend {
  name: "sim" | "live";
  /** Start streaming world state into the store. Returns a stop fn. */
  start(): () => void;
  /** Token balances for a wallet, per agent id (the voting weight source). */
  holdings(wallet: string): Promise<Record<string, number>>;
  /** Cast a vote. Weight is the balance snapshot taken when the vote opened. */
  vote(voteId: string, option: string, wallet: string): Promise<void>;
  /** Open a proposal. Costs PROPOSAL_FEE SOL, paid into the agent's vault. */
  propose(agentId: string, field: VoteField, wallet: string, reason?: string): Promise<string>;
  /** Launch the agent's coin on pump.fun and give it a wallet. Returns agent id. */
  hire(input: HireInput, wallet: string): Promise<string>;
}
