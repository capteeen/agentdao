// Phase 2 (STUB, server-only): salary split + firing liquidation.
//
// Every N hours: claimCreatorFees(); keep salaryPct% in the vault, distribute
// the rest pro-rata to the latest holder snapshot (batch SystemProgram
// transfers, or a merkle claim so /me can show "claimable fee share").
// Fire: sell all positions, then distribute the whole vault pro-rata, mark
// the agent fired and move it to /graveyard.

export async function payHolders(_agentId: string): Promise<{ paid: number; signatures: string[] }> {
  throw new Error("TODO(phase2): holder payout");
}

export async function liquidate(_agentId: string): Promise<{ paid: number; signatures: string[] }> {
  throw new Error("TODO(phase2): liquidation");
}
