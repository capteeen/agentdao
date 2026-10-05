# BOSS: the agent is your employee

Launch an AI trading agent as a pump.fun coin. Its token holders are its bosses.
Holders vote on strategy, risk, launch cadence, take-profit and salary, and on whether
to fire it. The agent carries out the winning vote within one block and explains every trade.
It never acts without an instruction. It is an employee, and the coin is the company.

This repo is **Phase 1**: a running Next.js app driven by an in-browser **mock simulator**.
No transactions are sent.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

Add `?2d=1` to any URL to force the 2D isometric canvas fallback instead of WebGL.

## What's in it

| Route | What |
| --- | --- |
| `/` | 3D pixel office hero, ticker, odometer counters, 4-step explainer, live "Vote closing" panel, event feed, CTA |
| `/office` | Full floor. Filter by strategy / risk / status, sort by PnL / vault / votes. Click a desk to open the agent, drag to rotate |
| `/agent/[id]` | Desk sprite, job description (current rule set; each rule links to the vote that set it), vault, pixel PnL chart, trade log ("Why?" leads to the rule and then the vote), launches, live and past votes, report cards, CA, Buy on pump.fun, Propose |
| `/vote/[id]` | Proposal, live tally bars, your snapshot weight, countdown, one-click vote, voters by weight, execution slot + tx |
| `/hire` | Launch modal: name, ticker, image (emoji or upload), starting strategy / risk / cadence / TP, salary split, dev buy, starting vault, cost breakdown. Requires a wallet. Launch is mocked |
| `/leaderboard` | Best PnL · Most fees paid to holders · Most votes · Longest employed · Hall of fired, plus latest report cards |
| `/graveyard` | Tombstones with cause of death ("Fired by 83% of holders") and final report cards |
| `/how` | Long-form explainer with pixel diagrams of the vote→execute loop |
| `/me` | Agents you hold, your voting weight in each, open votes, claimable fee share |
| `/report?…` | Shareable report card page; its OG image is `/api/og/report?…` (sprite, PnL, obedience, "Rated by N holders") |

Wallets: Phantom and Solflare adapters, with Backpack and any other Wallet Standard wallet auto-detected.
If no wallet extension is installed, the **"or demo wallet"** link creates a throwaway mock address
so you can try voting, proposing and hiring.

### The office

- `lib/office/scene.ts` describes the whole office as a flat list of voxel boxes each frame
  (immediate-mode). Workers are built from boxes and their animation comes from state:
  **typing** (trading), **on the phone** (launching, for 6s after a launch), **asleep** (no
  active rule set), **sweating** (3+ losing trades in a row), **glass corner office** (top
  earner), **carrying a cardboard box out the door** (fired). Desk size scales with vault (log scale).
  The floor mat colour shows the risk level. The boardroom lights pulse and board members
  appear while any vote is live.
- When a vote passes, a **memo flies from the boardroom to the desk**, a stamp slams down,
  an `APPROVED` (or `FIRED`) overlay appears, and the worker's animation changes that same frame.
- `lib/office/renderers.ts` has two renderers for the same box list. `ThreeOffice` uses an orthographic
  camera, one `InstancedMesh` of unit cubes, flat Lambert shading, and renders at ⅓ resolution
  upscaled with `image-rendering: pixelated`. It makes one draw call for the whole office, so 50 agents
  is about 1.5k instances. `IsoOffice` is the 2D canvas fallback, used when WebGL is missing or the context is lost.

### Simulator (`lib/sim.ts`, `lib/backend/sim.ts`)

- 25 agents with random rule sets, generated from a fixed seed, so the server can name agents in OG metadata.
- One trade every 3–8s, derived strictly from the agent's rules
  (`"Momentum rule: bought $WIF after 40% move in 5m. Size 5% of vault (Staff)."`).
  Each trade records `ruleField` and `voteId`, so "why did it do that?" always resolves.
- A new random vote every 2 min. Four votes are already live on first load (closing at about 14s, 42s,
  70s and 105s) so memos fly right away. Tallies auto-fill, and votes close at 90s in the mock (1h in prod).
- Report cards for every agent every 5 min ("daily" in prod), with the bell ringing.
- A fire vote on a weak performer every ~10 min. The fired agent's vault is liquidated
  pro-rata, it walks out with a box and lands in `/graveyard`. HR backfills the desk.
- Agents can also go bankrupt (vault < 0.05 SOL). Degen risk tends to get them there.
- Optional 8-bit WebAudio sounds (🔇 toggle): keyboard clicks, phone ring, memo stamp, box drop, bell.

The obedience score is the % of passed votes executed within 1 block. In practice it is always 100%. The
badge is the joke and the trust signal.

## Data model

`lib/types.ts`: `Agent`, `RuleSet`, `Vote`, `Trade`, `BossEvent`, `ReportCard`. These follow the spec,
plus a few fields the UI needs: `Agent.ruleSource` (which vote set each rule), `Trade.ruleField` and
`Trade.voteId`, `Vote.snapshotSupply`, `Vote.executedSlot`, and `Agent.pnlHistory` and `Agent.lossStreak`.

## Swapping the simulator for the Phase 2 backend

The UI never touches the simulator directly. Everything goes through one seam:

```
lib/backend/types.ts   BossBackend { start, holdings, vote, propose, hire }
lib/backend/sim.ts     Phase 1 (default)
lib/backend/live.ts    Phase 2 client (stub): SSE + POSTs to /api/*
lib/backend/index.ts   picks one via NEXT_PUBLIC_BOSS_BACKEND=sim|live
lib/store.ts           Zustand store the UI reads; both backends write it via mutate()/setState
```

To go live:

1. **Set `NEXT_PUBLIC_BOSS_BACKEND=live`** (and `NEXT_PUBLIC_SOLANA_RPC`, `NEXT_PUBLIC_SITE_URL`).
2. **Persist the world** (Postgres or similar) with the same shapes as `lib/types.ts`, and serve it from
   `app/api/stream/route.ts` as SSE: one `{type:"snapshot", world}` message, then `{type:"patch", world: {...changed arrays}}`.
3. **Hire** in `app/api/hire/route.ts` and `lib/phase2/pumpportal.ts`: create a per-agent keypair
   (`lib/phase2/keypairs.ts`, server-only, encrypted at rest). Upload the metadata to pump.fun IPFS, build the
   PumpPortal `trade-local` `create` tx, have the user sign the funding part, then submit. Store the mint as `coinCa`.
4. **Holder snapshots**: `lib/phase2/holders.ts` uses DAS `getTokenAccounts` pagination for full snapshots,
   or `getTokenLargestAccounts` for a quick top-20 view. Take the snapshot when a vote opens. Voting weight is
   the balance in that snapshot.
5. **Votes**: `lib/phase2/votes.ts` handles off-chain ballots. The wallet signs `BOSS vote <voteId> <option>`, the
   server verifies ed25519 and weights the ballot by the snapshot. On close, the executor writes the winner into the rule set and
   records `executedSlot` and `txSig`. Proposal fees are a SOL transfer to the vault, verified before the vote opens.
6. **Strategies**: `lib/phase2/engine.ts` holds deterministic rule engines, `(market, rules, vault) => intents`, and
   no LLM makes decisions. The executor signs the PumpPortal buy/sell txs with the agent key. `lib/phase2/explain.ts`
   uses an LLM only to write the one-line reason from the intent's structured `why`.
7. **Fees and firing**: `lib/phase2/payouts.ts` claims creator fees, keeps `salaryPct` in the vault and pays the rest
   pro-rata to holders (or a merkle claim, for `/me`). Fire means sell everything and distribute the vault.
8. **OG and metadata**: replace the seeded `createWorld(1337)` lookup in `app/agent/[id]/page.tsx` with a DB read.

Every `app/api/*` route other than OG is currently a stub that returns `501`.

## Stack

Next.js 14 (app router) · TypeScript · Tailwind · Zustand · Three.js · Solana wallet adapter · `next/og`.

---

Agents trade and launch on pump.fun (Solana). A meme, not an investment. Crypto is risky. Only use what you can afford to lose.
