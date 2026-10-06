// Server configuration. Everything comes from the environment; see .env.example.

export type ExecMode = "paper" | "live";
export type MarketSource = "pumpportal" | "synthetic";

const env = (k: string, d = "") => process.env[k] ?? d;

export const CFG = {
  /** paper: real governance + market data, simulated fills, no keys needed. live: signs real txs. */
  mode: (env("BOSS_MODE", "paper") as ExecMode) === "live" ? "live" : ("paper" as ExecMode),
  /** pumpportal: wss://pumpportal.fun/api/data. synthetic: offline generator (dev / CI). */
  market: (env("BOSS_MARKET", "pumpportal") as MarketSource) === "synthetic" ? "synthetic" : ("pumpportal" as MarketSource),
  dbPath: env("BOSS_DB", "./data/boss.sqlite"),
  rpc: env("SOLANA_RPC", env("NEXT_PUBLIC_SOLANA_RPC", "https://api.mainnet-beta.solana.com")),
  /** 32-byte hex key for AES-256-GCM encryption of agent secret keys. Required in live mode. */
  keyEncryptionKey: env("BOSS_KEY_ENCRYPTION_KEY"),
  pumpportalApiKey: env("PUMPPORTAL_API_KEY"), // optional: lightning tx API; we use trade-local by default
  /** Treasury that receives proposal fees when the agent has no wallet yet (paper mode). */
  treasury: env("BOSS_TREASURY", ""),
  explainModel: env("BOSS_EXPLAIN_MODEL", "claude-opus-5-5"),
  explainEnabled: env("BOSS_EXPLAIN", "1") !== "0",
  // Governance
  voteMs: Number(env("BOSS_VOTE_MS", String(60 * 60 * 1000))),
  quorum: Number(env("BOSS_QUORUM", "0.05")),
  proposalFeeSol: Number(env("BOSS_PROPOSAL_FEE", "0.01")),
  // Cadence
  tickMs: Number(env("BOSS_TICK_MS", "2000")),
  evalEveryMs: Number(env("BOSS_EVAL_MS", "20000")), // how often each agent's rule engine looks at the market
  reportEveryMs: Number(env("BOSS_REPORT_MS", String(24 * 60 * 60 * 1000))),
  feeClaimEveryMs: Number(env("BOSS_FEE_CLAIM_MS", String(6 * 60 * 60 * 1000))),
  gossipEveryMs: Number(env("BOSS_GOSSIP_MS", "60000")),
  obeyTradeMs: Number(env("BOSS_OBEY_MS", "2000")),
  /** Token supply used for pump.fun coins (1B with 6 decimals). */
  supply: 1_000_000_000,
  decimals: 6,
  minVaultSol: 0.05,
  /** Paper mode: fee a launch earns per observed buy of its coin (0.95% creator fee approx). */
  creatorFeeRate: 0.0095,
};

export function assertLiveConfig() {
  if (CFG.mode !== "live") return;
  if (!/^[0-9a-f]{64}$/i.test(CFG.keyEncryptionKey)) throw new Error("BOSS_KEY_ENCRYPTION_KEY must be 32 bytes hex in live mode");
}
