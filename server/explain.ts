// One-line trade explanations. The LLM never decides anything: it phrases a
// structured Intent (rule + why) in one sentence. Template fallback when the
// API is disabled, unreachable, slow, or refuses.

import Anthropic from "@anthropic-ai/sdk";
import type { Intent } from "../lib/phase2/engine";
import type { RuleSet } from "../lib/types";
import { LABEL, RISK_PCT } from "../lib/rules";
import { CFG } from "./config";

let client: Anthropic | null = null;
function api() {
  if (!CFG.explainEnabled) return null;
  try {
    return (client ??= new Anthropic({ timeout: 8_000, maxRetries: 1 }));
  } catch {
    return null;
  }
}

/** Deterministic fallback; also the canonical phrasing the model is asked to match. */
export function templateReason(intent: Intent, rules: RuleSet, extra: { mult?: number; sizePct?: number } = {}): string {
  const w = intent.why;
  const t = intent.ticker ? `$${intent.ticker}` : "the coin";
  const size = ` Size ${((extra.sizePct ?? RISK_PCT[rules.risk]) * 100).toFixed(0)}% of vault (${LABEL[rules.risk]}).`;
  switch (intent.rule) {
    case "strategy":
      if (rules.strategy === "sniper") return `Sniper rule: bought ${t} ${w.ageBlocks} blocks after launch, dev holds ${Number(w.devPct).toFixed(0)}%.${size}`;
      if (rules.strategy === "momentum") return `Momentum rule: bought ${t} after ${(Number(w.move5m) * 100).toFixed(0)}% move in 5m.${size}`;
      if (rules.strategy === "copytrade") return `Copy-trade rule: mirrored ${String(w.wallet).slice(0, 4)}… buying ${t}.${size}`;
      return `Fee-farmer rule: bought back own launch ${t} to support the curve.${size}`;
    case "takeProfit":
      return rules.takeProfit === "never" ? `Take-profit rule (never): held ${t} until the curve stalled, exited at ${Number(w.mult).toFixed(1)}x.` : `Take-profit rule (${rules.takeProfit}): sold ${t} at ${Number(w.mult).toFixed(1)}x.`;
    case "risk":
      return `Risk rule (${LABEL[rules.risk]}): stop-loss on ${t} at ${Number(w.stop).toFixed(0)}%.`;
    case "cadence":
      return rules.strategy === "feefarmer"
        ? `Fee-farmer rule + ${LABEL[rules.cadence].toLowerCase()} cadence: launched ${t}, dev-bought ${Number(w.devBuy).toFixed(2)} SOL, now farming creator fees.`
        : `Cadence rule (${LABEL[rules.cadence].toLowerCase()}): launch slot came up, launched ${t}.`;
    default:
      return `${intent.kind} ${t}`;
  }
}

const SYSTEM = `You write the one-line trade log entry for an AI trading agent whose rules are set by its token holders' votes.
Rules: one sentence, max 140 characters, plain text. Name the rule that caused the action (it is given). Use the numbers given, do not invent any. No advice, no hype, no emoji. Match the tone of: "Momentum rule: bought $WIF after 40% move in 5m. Size 5% of vault (Staff)."`;

/** Phrase an intent. Returns the template on any failure, never throws. */
export async function explain(intent: Intent, rules: RuleSet, agentTicker: string, extra: { mult?: number; sizePct?: number } = {}): Promise<string> {
  const fallback = templateReason(intent, rules, extra);
  const c = api();
  if (!c) return fallback;
  try {
    const res = await c.beta.messages.create({
      model: CFG.explainModel,
      max_tokens: 200,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({ agent: `$${agentTicker}`, action: intent.kind, coin: intent.ticker ? `$${intent.ticker}` : undefined, rule: intent.rule, ruleValue: rules[intent.rule as keyof RuleSet], why: intent.why, ...extra, referencePhrasing: fallback }),
        },
      ],
    });
    if (res.stop_reason === "refusal") return fallback;
    const text = res.content.find((b) => b.type === "text")?.text.trim().replace(/\s+/g, " ");
    return text && text.length <= 180 ? text : fallback;
  } catch {
    return fallback;
  }
}
