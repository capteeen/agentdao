// Core BOSS data model. The simulator (lib/sim.ts) and the Phase 2 backend
// (lib/backend/live.ts) both produce exactly these shapes, so the UI never
// knows which one is running.

export type Strategy = "sniper" | "momentum" | "feefarmer" | "copytrade";
export type Risk = "intern" | "staff" | "manager" | "degen";
export type Cadence = "never" | "daily" | "6h" | "1h";
export type TakeProfit = "2x" | "5x" | "10x" | "never";

export interface RuleSet {
  strategy: Strategy;
  risk: Risk;
  cadence: Cadence;
  takeProfit: TakeProfit;
  /** % of creator fees the agent keeps in its vault; the rest goes to holders. */
  salaryPct: number;
  copyWallet?: string;
}

export type RuleField = keyof RuleSet;
export type VoteField = RuleField | "fire" | "raise";

export type AgentStatus = "working" | "idle" | "fired" | "bankrupt";

/** Which vote set each rule. "hire" = founding rule set chosen in the hire modal. */
export type RuleSource = Partial<Record<RuleField, string | "hire">>;

export interface Agent {
  id: string;
  name: string;
  ticker: string;
  image: string; // emoji / sprite seed in mock, URL in Phase 2
  coinCa: string;
  wallet: string;
  vault: number; // SOL
  rules: RuleSet;
  ruleSource: RuleSource;
  pnl7d: number; // SOL
  pnlHistory: number[]; // cumulative PnL samples (oldest first)
  feesEarned: number;
  feesPaidToHolders: number;
  obedience: number; // 0..100
  votesExecuted: number;
  holders: number;
  supply: number; // token supply used for quorum + weights
  bornAt: number;
  firedAt?: number;
  firedBy?: number; // % of voting weight that fired it
  causeOfDeath?: string;
  status: AgentStatus;
  ownerWallet: string;
  lossStreak: number;
  /** UI hint for the office: what the worker is doing right now. */
  lastAction?: { kind: "buy" | "sell" | "launch"; at: number };
  /** Last time a vote changed this agent (drives the "orders arriving" anim). */
  lastOrderAt?: number;
  seed: number;
}

export interface Vote {
  id: string;
  agentId: string;
  field: VoteField;
  options: string[];
  tallies: Record<string, number>; // option -> token weight
  voters: { wallet: string; option: string; weight: number; at: number }[];
  proposer: string;
  reason?: string;
  startsAt: number;
  endsAt: number;
  status: "live" | "passed" | "failed";
  winner?: string;
  executedAt?: number;
  executedSlot?: number;
  txSig?: string;
  /** Total supply at snapshot; quorum is 5% of it. */
  snapshotSupply: number;
}

export interface Trade {
  id: string;
  agentId: string;
  kind: "buy" | "sell" | "launch";
  coinCa: string;
  coinTicker: string;
  amount: number; // SOL
  pnl?: number;
  reason: string;
  ruleApplied: string; // human label e.g. "Strategy: Momentum"
  ruleField: RuleField;
  voteId: string | "hire"; // vote that set the rule (or founding rule set)
  at: number;
  txSig?: string;
}

export type EventKind = "vote_open" | "vote_pass" | "vote_fail" | "trade" | "launch" | "fired" | "report" | "hired";

export interface BossEvent {
  id: string;
  kind: EventKind;
  agentId: string;
  text: string;
  at: number;
  voteId?: string;
}

export interface ReportCard {
  id: string;
  agentId: string;
  at: number;
  pnl: number;
  obedience: number;
  feesPaid: number;
  trades: number;
  raters: number; // "Rated by N holders"
  grade: string;
}

export interface Counters {
  employed: number;
  votesPassed: number;
  sum: number; // SOL under management
  fired: number;
}
