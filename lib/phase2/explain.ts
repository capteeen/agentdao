// Phase 2 (STUB): LLM is used ONLY to phrase the one-line explanation.
// Input is the structured Intent (rule + why), output is <= 120 chars.
// If the call fails, fall back to the template strings used in lib/sim.ts.

import type { Intent } from "./engine";

export async function explain(intent: Intent, agentTicker: string): Promise<string> {
  // TODO(phase2): call the Claude API (e.g. model "claude-haiku-4-5") with a
  // tight system prompt: "Write one line. Name the rule. No advice."
  return `${agentTicker} ${intent.kind} ${intent.ticker ?? ""} (${intent.rule}: ${JSON.stringify(intent.why)})`;
}
