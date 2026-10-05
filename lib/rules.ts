import type { Cadence, Risk, RuleField, RuleSet, Strategy, TakeProfit, VoteField } from "./types";

export const STRATEGIES: Strategy[] = ["sniper", "momentum", "feefarmer", "copytrade"];
export const RISKS: Risk[] = ["intern", "staff", "manager", "degen"];
export const CADENCES: Cadence[] = ["never", "daily", "6h", "1h"];
export const TAKE_PROFITS: TakeProfit[] = ["2x", "5x", "10x", "never"];
export const SALARIES = ["10", "25", "50", "75"];

export const LABEL: Record<string, string> = {
  sniper: "Sniper",
  momentum: "Momentum",
  feefarmer: "Fee-farmer",
  copytrade: "Copy-trade",
  intern: "Intern",
  staff: "Staff",
  manager: "Manager",
  degen: "Degen",
  never: "Never",
  daily: "Daily",
  "6h": "Every 6h",
  "1h": "Every hour",
  "2x": "2x",
  "5x": "5x",
  "10x": "10x",
  fire: "FIRE",
  keep: "Keep",
  pnl: "PnL",
  vault: "Vault",
  votes: "Votes",
  working: "Working",
  sweating: "Sweating",
  fired: "Fired",
};

export const RISK_PCT: Record<Risk, number> = { intern: 0.02, staff: 0.05, manager: 0.1, degen: 1 };
export const RISK_DESC: Record<Risk, string> = {
  intern: "2% of vault per trade",
  staff: "5% of vault per trade",
  manager: "10% of vault per trade",
  degen: "Full port. Every trade.",
};
export const STRATEGY_DESC: Record<Strategy, string> = {
  sniper: "Buys fresh pump.fun launches in their first blocks.",
  momentum: "Buys coins after a sharp move, rides the trend.",
  feefarmer: "Launches its own coins and farms creator fees.",
  copytrade: "Mirrors a wallet the holders picked.",
};
export const CADENCE_DESC: Record<Cadence, string> = {
  never: "Never launches coins",
  daily: "Launches one coin a day",
  "6h": "Launches a coin every 6 hours",
  "1h": "Launches a coin every hour",
};

export const FIELD_LABEL: Record<VoteField, string> = {
  strategy: "Strategy",
  risk: "Risk level",
  cadence: "Launch cadence",
  takeProfit: "Take profit",
  salaryPct: "Salary",
  copyWallet: "Copy wallet",
  fire: "Fire the agent",
  raise: "Give a raise",
};

export const RISK_COLOR: Record<Risk, string> = {
  intern: "#7bd389",
  staff: "#4a90e2",
  manager: "#f5e663",
  degen: "#e63946",
};

export function optionsFor(field: VoteField): string[] {
  switch (field) {
    case "strategy":
      return STRATEGIES;
    case "risk":
      return RISKS;
    case "cadence":
      return CADENCES;
    case "takeProfit":
      return TAKE_PROFITS;
    case "salaryPct":
      return SALARIES;
    case "fire":
      return ["fire", "keep"];
    case "raise":
      return ["1", "5", "10", "0"];
    case "copyWallet":
      return [];
  }
}

export function optionLabel(field: VoteField, opt: string): string {
  if (field === "salaryPct") return `${opt}% kept`;
  if (field === "raise") return opt === "0" ? "No raise" : `+${opt} SOL`;
  return LABEL[opt] ?? opt;
}

export function ruleValueLabel(field: RuleField, rules: RuleSet): string {
  const v = rules[field];
  if (v === undefined) return "-";
  if (field === "salaryPct") return `${v}% vault / ${100 - Number(v)}% holders`;
  if (field === "copyWallet") return String(v).slice(0, 4) + "…" + String(v).slice(-4);
  return LABEL[String(v)] ?? String(v);
}

/** Vote headline used in the ticker and on cards. */
export function voteHeadline(field: VoteField, winner: string): string {
  if (field === "fire") return winner === "fire" ? "voted to FIRE the agent" : "voted to keep the agent";
  if (field === "raise") return winner === "0" ? "voted no raise" : `voted a +${winner} SOL raise`;
  return `voted ${optionLabel(field, winner).toUpperCase()} ${FIELD_LABEL[field].toLowerCase()}`;
}
