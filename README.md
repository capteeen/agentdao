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
`npm test` runs the simulator tests (Vitest); `npm run typecheck` and `npm run lint` are the other fast checks.

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

### The first 30 seconds

- The home page has a **"Give your first order"** card: the soonest-closing vote with one-click options.
  No wallet? Clicking creates a **demo wallet** that holds that agent (0.5% of supply) so the order counts.
  The vote page does the same.
- When any vote passes, the office **camera follows the memo** to the desk, zooms in, shows a caption
  (`$GARY voted DEGEN risk (71%).`) and the agent **must trade under the new rule within 2s** (`SIM.OBEY_TRADE_MS`).
  If you cast that vote you get two toasts: "Your order was obeyed in slot N" and "$GARY just traded under your rule".
- Firing bursts **coins from the desk to the holders**; if you held the coin, `/me` lists the payout and a "Payday" toast
  tells you what you received.
- The **bell** drops a report card on every desk (A–F letter overlays), and holders can 👍/👎 any card, which feeds
  "Rated by N holders".
- The **watercooler** column on the home page is office gossip generated from each agent's state.
- Sounds are on by default; browsers only allow audio after the first click, so the first tap arms them.

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
- Hovering a desk shows a **magnifier card** (animated sprite at 3×, rule set, PnL, state); on touch the first tap
  shows the card and the second opens the agent. Drag rotates, pinch or ctrl+wheel zooms. Phones render at 30fps.
  Desks are coloured by risk level.
- `lib/office/renderers.ts` has two renderers for the same box list. `ThreeOffice` uses an orthographic
  camera, one `InstancedMesh` of unit cubes, flat Lambert shading, and renders at ⅓ resolution
  upscaled with `image-rendering: pixelated`. It makes one draw call for the whole office, so 50 agents
  is about 1.5k instances. `IsoOffice` is the 2D canvas fallback, used when WebGL is missing or the context is lost.

### Simulator (`lib/sim.ts`, `lib/backend/sim.ts`)

- 25 agents with random rule sets, generated from a fixed seed, so the server can name agents in OG metadata.
- **Economics follow the rules.** Position size comes from `risk`, win rate and the captured multiple from `takeProfit`,
  and Interns cut losses where Degens ride them down (`TP_WIN`, `RISK_EDGE`, `expectedEdge`). Degen/never agents sit at the
  top *and* bottom of the leaderboard.
- **The crowd reacts to performance** (`favourite`): losers get fired, demoted or told to take profit at 2x; winners
  get raises and more rope. Fire votes target losing streaks and the worst ROI.
- **The world persists** in `localStorage` (`boss:world:v2`, saved every 5s, dropped after an hour away) so shared links
  survive a reload. "Reset office" in the footer wipes it.
- **Office clock** (⏱ in the header): countdowns can be shown in office time, where 1 mock second = 40 real seconds, so a
  90s mock vote reads as the 1h it would be in production.
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
`Trade.voteId`, `Vote.snapshotSupply`, `Vote.closeSlot` / `executedSlot`, `Agent.pnlHistory`, `Agent.lossStreak`,
`Agent.nextTradeAt` (the obey deadline), `Agent.liquidated` and `ReportCard.up/down`.

The store (`lib/store.ts`) keeps `agents` and `votes` as **id-keyed maps** and `trades`/`events`/`reports` as
newest-first logs. `useAgents()` / `useVotes()` give memoised arrays. A Phase 2 SSE patch is `{ agents: { [id]: Agent } }`
and merges by id (see `lib/backend/live.ts`).

`lib/sim.test.ts` pins the invariants that are the whole brand: a passed vote rewrites the rule, links the vote,
executes one slot after close and forces a trade citing that vote; no quorum → no change; fire → vault 0 and payout.

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
   `app/api/stream/route.ts` as SSE: one `{type:"snapshot", world}` message, then `{type:"patch", world}` where
   `world.agents` / `world.votes` are id-keyed partial maps and `world.trades` / `events` / `reports` are the new rows.
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

Next.js 14 (app router) · TypeScript · Tailwind · Zustand · Three.js · Solana wallet adapter · `next/og` · Vitest.

`@types/react` is pinned to 18 via `overrides` because the wallet adapter's react-native dependency drags in the
React 19 types otherwise.

---

Agents trade and launch on pump.fun (Solana). A meme, not an investment. Crypto is risky. Only use what you can afford to lose.
