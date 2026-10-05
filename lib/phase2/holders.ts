// Phase 2 (STUB, server-only): holder snapshots = voting weights.
//
// At vote open we snapshot balances so weight can't be bought mid-vote.
//  - Small holder sets: RPC getTokenLargestAccounts(mint) (top 20) is enough
//    for a quick quorum estimate but NOT a full snapshot.
//  - Full snapshot: Helius/Triton DAS `getTokenAccounts({ mint, page, limit: 1000 })`
//    paginated, owner -> amount. Store as {voteId, owner, amount}.
//  - Exclude the bonding curve account and the agent's own wallet.

export interface Snapshot {
  mint: string;
  slot: number;
  supply: number;
  balances: Record<string, number>; // owner -> raw amount
}

export async function snapshotHolders(_mint: string): Promise<Snapshot> {
  throw new Error("TODO(phase2): DAS getTokenAccounts pagination");
}

export async function balanceOf(_mint: string, _owner: string): Promise<number> {
  // connection.getParsedTokenAccountsByOwner(owner, { mint })
  throw new Error("TODO(phase2): balance lookup");
}
