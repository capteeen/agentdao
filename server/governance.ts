// Governance: proposals, holder snapshots, signed ballots, tallies, execution.
//
// Weight = balance in the snapshot taken when the vote opened. Ballots are
// `BOSS vote <id> <option>` signed by the holder; the server verifies ed25519,
// looks up the snapshot weight, and rejects duplicates. Tallies are public and
// recomputable from stored ballots.

import type { Agent, RuleField, RuleSet, Vote, VoteField } from "../lib/types";
import { FIELD_LABEL, optionsFor } from "../lib/rules";
import { passText } from "../lib/sim";
import { fakeSig, hashStr, mulberry32 } from "../lib/util";
import { CFG } from "./config";
import { addEvent, getSnapshot, getVote, hasBallot, saveBallot, saveSnapshot, saveVote, type Snapshot } from "./db";
import { ballotMessage, snapshotHolders, tokenSupply, verifySigned, verifyTransfer } from "./solana";

const nid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Holder snapshot for an agent's coin. In paper mode with a fake mint, a synthetic distribution. */
export async function takeSnapshot(a: Agent, voteId: string): Promise<Snapshot> {
  if (CFG.mode === "live" || a.coinCa.length === 44) {
    try {
      const [{ slot, balances }, supply] = await Promise.all([snapshotHolders(a.coinCa, [a.wallet]), tokenSupply(a.coinCa)]);
      const s = { voteId, mint: a.coinCa, slot, supply, balances };
      saveSnapshot(s);
      return s;
    } catch (e) {
      if (CFG.mode === "live") throw e;
    }
  }
  // paper: the owner holds the dev buy, plus a synthetic board of ~30 holders
  // (~7% of supply) so votes can reach quorum without real buyers. Their wallets
  // are prefixed "paper" so the worker can vote for them and the UI can tell.
  const balances: Record<string, number> = { [a.ownerWallet]: Math.floor(a.supply * 0.04) };
  const r = mulberry32(hashStr(voteId));
  for (let i = 0; i < 30; i++) balances[`paper${voteId}${i.toString(36)}`] = Math.floor(a.supply * (0.0005 + r() * 0.004));
  const s = { voteId, mint: a.coinCa, slot: 0, supply: a.supply, balances };
  saveSnapshot(s);
  return s;
}

export async function openVote(a: Agent, field: VoteField, proposer: string, reason: string | undefined, now: number, slot: number): Promise<Vote> {
  const id = nid("v");
  const snap = await takeSnapshot(a, id);
  const v: Vote = {
    id,
    agentId: a.id,
    field,
    options: optionsFor(field),
    tallies: Object.fromEntries(optionsFor(field).map((o) => [o, 0])),
    voters: [],
    proposer,
    reason,
    startsAt: now,
    endsAt: now + CFG.voteMs,
    status: "live",
    snapshotSupply: snap.supply || a.supply,
  };
  saveVote(v);
  addEvent({ id: nid("e"), kind: "vote_open", agentId: a.id, text: `New vote on $${a.ticker}: ${FIELD_LABEL[field]}. Closes in ${Math.round(CFG.voteMs / 60000)}m. Snapshot at slot ${snap.slot || slot}.`, at: now, voteId: id });
  return v;
}

/** Weight of `wallet` in a vote (snapshot balance, or live balance in paper mode when not in the snapshot). */
export function weightOf(v: Vote, wallet: string): number {
  const snap = getSnapshot(v.id);
  return snap?.balances[wallet] ?? 0;
}

export interface BallotInput {
  voteId: string;
  option: string;
  wallet: string;
  signature: string;
  /** paper mode only: a demo wallet may self-declare a balance (never trusted in live mode). */
  paperWeight?: number;
}

export function castBallot(b: BallotInput, now = Date.now()): Vote {
  const v = getVote(b.voteId);
  if (!v) throw new Error("No such vote");
  if (v.status !== "live" || now >= v.endsAt) throw new Error("Vote is closed");
  if (!v.options.includes(b.option)) throw new Error("Invalid option");
  if (hasBallot(v.id, b.wallet)) throw new Error("Already voted");
  if (!verifySigned(ballotMessage(v.id, b.option), b.signature, b.wallet)) throw new Error("Bad signature");
  let weight = weightOf(v, b.wallet);
  if (!weight && CFG.mode === "paper" && b.paperWeight) weight = Math.min(b.paperWeight, v.snapshotSupply * 0.01);
  if (!weight) throw new Error("You held none of this coin when the vote opened");
  saveBallot({ voteId: v.id, wallet: b.wallet, option: b.option, weight, signature: b.signature, at: now });
  const nv: Vote = { ...v, tallies: { ...v.tallies, [b.option]: (v.tallies[b.option] ?? 0) + weight }, voters: [{ wallet: b.wallet, option: b.option, weight, at: now }, ...v.voters].slice(0, 500) };
  saveVote(nv);
  return nv;
}

/** Proposal fee: a transfer from the proposer to the agent wallet (verified on-chain in live mode). */
export async function verifyProposalFee(proposer: string, a: Agent, feeTx: string | undefined): Promise<void> {
  if (CFG.mode !== "live") return;
  if (!feeTx) throw new Error("Proposal fee transaction required");
  const ok = await verifyTransfer(feeTx, proposer, a.wallet, CFG.proposalFeeSol);
  if (!ok) throw new Error(`Fee tx must send ${CFG.proposalFeeSol} SOL from you to the agent vault`);
}

export interface CloseOutcome {
  vote: Vote;
  passed: boolean;
  winner?: string;
  /** For rule votes: the new rule set and which field changed. */
  rules?: RuleSet;
  field?: RuleField;
}

/** Tally a vote at close. Pure: does not touch the agent. */
export function tally(v: Vote, a: Agent, now: number, slot: number): CloseOutcome {
  const total = Object.values(v.tallies).reduce((s, x) => s + x, 0);
  const employed = a.status === "working" || a.status === "idle";
  if (total < v.snapshotSupply * CFG.quorum || !employed) {
    return { vote: { ...v, status: "failed", closeSlot: slot }, passed: false };
  }
  const winner = Object.entries(v.tallies).sort((x, y) => y[1] - x[1])[0][0];
  const vote: Vote = { ...v, status: "passed", winner, closeSlot: slot, executedAt: now, executedSlot: slot + 1, txSig: CFG.mode === "live" ? undefined : fakeSig(() => Math.random()) };
  if (v.field === "fire" || v.field === "raise") return { vote, passed: true, winner };
  const field = v.field as RuleField;
  const value = field === "salaryPct" ? Number(winner) : winner;
  return { vote, passed: true, winner, field, rules: { ...a.rules, [field]: value } as RuleSet };
}

export { passText };
