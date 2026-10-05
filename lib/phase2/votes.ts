// Phase 2 (STUB, server-only): off-chain signed votes.
//
// A ballot is the message `BOSS vote <voteId> <option>` signed by the holder
// (ed25519, verify with tweetnacl against the base58 pubkey). Weight is read
// from the snapshot taken at vote open. Tallies are public and recomputable
// from the stored ballots. When a vote passes the executor applies the new
// rule set and records the execution tx signature on the vote (txSig) — the
// "within one block" obedience score is executedSlot - closeSlot <= 1.

export interface Ballot {
  voteId: string;
  option: string;
  wallet: string;
  signature: string;
}

export function ballotMessage(voteId: string, option: string) {
  return `BOSS vote ${voteId} ${option}`;
}

export async function verifyBallot(_b: Ballot): Promise<boolean> {
  throw new Error("TODO(phase2): ed25519 verify");
}
