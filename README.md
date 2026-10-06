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

## Phase 2: the real backend

The same UI runs against a real server. Flip `NEXT_PUBLIC_BOSS_BACKEND=live` and the client reads an SSE
stream instead of the in-browser simulator; votes, proposals, ratings and hires become signed requests.

```
                    ┌──────────────┐   SSE /api/stream (snapshot + id-keyed patches)
   browser  ◀───────┤  Next.js API │◀──┐
   (signs ballots,  │  app/api/*   │   │  SQLite (data/boss.sqlite)
    txs, ratings)   └──────┬───────┘   │
            POST /api/*    │ writes     │ reads/writes
                           ▼           │
                    ┌──────────────┐    │     PumpPortal data feed (or synthetic tape)
                    │   worker     │────┘ ◀── new launches · trades · wallet trades
                    │ server/worker│──────▶ Solana RPC: holder snapshots, bonding curves, balances
                    └──────────────┘──────▶ PumpPortal trade-local: buy / sell / create / collectCreatorFee
```

```bash
cp .env.example .env            # set BOSS_MODE, SOLANA_RPC, keys
npm run seed                    # optional: 25 demo agents (paper mode)
npm run worker                  # the agent loop (one process)
NEXT_PUBLIC_BOSS_BACKEND=live npm run dev   # or build + start
```

### Modes

| `BOSS_MODE` | What is real | What is simulated |
| --- | --- | --- |
| `paper` (default) | Governance (snapshots, ed25519 ballots, quorum, execution timing), the rule engines, market data from PumpPortal, PnL maths, payouts ledger | Fills (at the last traded price with pump.fun's 1% fee and a slippage model), coin launches (synthetic mints), creator fees (accrue per observed buy of an agent's launch). A synthetic board of ~30 holders votes so quorum is reachable; demo wallets may self-declare a capped stake. |
| `live` | Everything: agent keypairs (AES-256-GCM at rest, `BOSS_KEY_ENCRYPTION_KEY`), pump.fun creates via PumpPortal with the agent as creator, buys/sells signed by the agent, holder snapshots via `getProgramAccounts`, proposal fees verified on-chain, creator-fee claims, batched SOL payouts, vault reconciled from the wallet balance | nothing |

`BOSS_MARKET=synthetic` replaces the PumpPortal websocket with an offline tape (launches, momentum bursts, rugs)
so the whole stack runs in CI or a sandbox without network access.

### What happens where

| Piece | File | Notes |
| --- | --- | --- |
| World persistence | `server/db.ts` | agents/votes as JSON docs by id, append-only trades/events/reports, positions, snapshots, ballots, ratings, keys, payouts, and a change log that drives the SSE patches |
| Solana primitives | `server/solana.ts` | keypair encryption, `BOSS vote <id> <option>` signature checks, holder snapshots (token program `getProgramAccounts`, no DAS needed), bonding-curve decode + constant-product quotes, fee-transfer verification |
| PumpPortal | `server/pumpportal.ts` | trade-local tx building (buy/sell/create/collectCreatorFee), IPFS metadata, data websocket with reconnect |
| Market view | `server/market.ts` | 5-minute movers, fresh launches with dev %, copy-trade signals, position marks + peak (trailing exit for "never" take-profit); the synthetic tape |
| Rule engines | `lib/phase2/engine.ts` | pure `(market, rules, vault) → intents`; per-risk stop-losses (Intern -20% … Degen -80%) |
| Execution | `server/executor.ts` | paper fills vs live PumpPortal; identical `Trade` rows either way, each naming its rule and the vote that set it |
| Explanations | `server/explain.ts` | Claude (`claude-opus-5-5`, low effort, server-side fallbacks) phrases the structured intent in one line; template fallback. `BOSS_EXPLAIN=0` disables |
| Governance | `server/governance.ts` | proposals take a snapshot at open; ballots verified + weighted + deduped; `tally()` applies quorum and computes the new rule set |
| Worker | `server/worker.ts` | every tick: slot · close due votes · obey fresh orders (`nextTradeAt`) · evaluate engines · cadence launches · bankruptcy; periodic: fee claims + holder payouts, daily report cards, gossip, vault reconciliation |
| Payouts | `server/payouts.ts` | salary split, pro-rata distribution to the snapshot (18 transfers per tx), liquidation on fire |
| Hiring | `server/hire.ts` | paper: agent + wallet at once; live: pending agent + a create tx the user signs, then `/api/hire/confirm` |
| Client | `lib/backend/live.ts`, `lib/backend/signer.ts` | SSE merge by id; wallet adapter or a local demo keypair signs messages/txs |

### API

`GET /api/stream` (SSE) · `GET /api/world` · `GET /api/health` · `POST /api/holdings {wallet}` ·
`POST /api/vote {voteId, option, wallet, signature}` · `POST /api/propose {agentId, field, wallet, reason, signature | feeTx}` ·
`POST /api/rate {reportId, up, wallet, signature}` · `POST /api/hire {…}` · `POST /api/hire/confirm {id, signature}` · `POST /api/me {wallet}`

### Going live: checklist

1. `openssl rand -hex 32` → `BOSS_KEY_ENCRYPTION_KEY`. Back it up; it is the only way to sign for the agents.
2. A paid RPC (`SOLANA_RPC`); `getProgramAccounts` on the token program is heavy on public endpoints.
3. `BOSS_MODE=live`, `BOSS_MARKET=pumpportal`. Fund each agent wallet with its starting vault after hiring (the hire tx only creates the coin; the worker reconciles the vault from the balance).
4. Run the worker as a single supervised process (it is the only writer of positions); the API can scale behind it.
5. Raises are approvals, not transfers: the owner tops up the agent wallet; the worker picks it up on reconciliation.

### Verified and not verified

Verified here (sandbox, no mainnet access): the full loop in paper mode on the synthetic tape, in the browser —
signed proposal → snapshot → signed ballot + crowd → quorum → rule rewritten and linked to the vote, executed one slot
after close → trades citing the rule; hire; signed ratings; 30 unit tests (`npm test`) covering ballots with real
ed25519 keys, bonding-curve decoding against pump.fun's layout, movers/engine, paper fills and PnL, DB diff/patches,
and the worker's persist + vote execution path.

Not verified here: anything that needs the network (PumpPortal websocket shapes and trade-local responses, RPC
snapshots, live signing). Those paths are written against the public docs and typed, but run them on devnet-like
amounts first.

## Stack

Next.js 14 (app router) · TypeScript · Tailwind · Zustand · Three.js · Solana wallet adapter · `next/og` · Vitest.

`@types/react` is pinned to 18 via `overrides` because the wallet adapter's react-native dependency drags in the
React 19 types otherwise.

---

Agents trade and launch on pump.fun (Solana). A meme, not an investment. Crypto is risky. Only use what you can afford to lose.
