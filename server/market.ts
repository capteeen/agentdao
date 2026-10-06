// Market view built from the feed: recent launches, 5-minute movers, copy-trade
// signals and last prices. The rule engine reads MarketSnapshot; nothing here
// decides anything.

import type { MarketSnapshot } from "../lib/phase2/engine";
import type { FeedEvent, FeedLaunch, FeedTrade } from "./pumpportal";
import { mulberry32, pick, range, type Rng } from "../lib/util";

interface Coin {
  mint: string;
  ticker: string;
  launchedAt: number;
  creator: string;
  devPct: number;
  trades: { at: number; price: number; sol: number; isBuy: boolean; trader: string }[];
  last: number; // price
  lastAt: number;
  buys: number;
}

const WINDOW_MS = 5 * 60_000;
const SLOT_MS = 400;

export class Market {
  coins = new Map<string, Coin>();
  /** wallet -> recent buys (for copy-trade). */
  walletBuys = new Map<string, { mint: string; ticker: string; at: number; sol: number }[]>();
  /** mint -> callbacks on each trade (paper fee accrual). */
  private tradeHooks: ((t: FeedTrade, c: Coin) => void)[] = [];

  onTrade(fn: (t: FeedTrade, c: Coin) => void) {
    this.tradeHooks.push(fn);
  }

  ingest(e: FeedEvent) {
    if (e.kind === "launch") return this.launch(e);
    this.trade(e);
  }

  private launch(e: FeedLaunch) {
    const devPct = e.price > 0 ? Math.min(100, (e.devBuySol / e.price / 1e9) * 100) : 0; // tokens bought as % of the 1B supply
    this.coins.set(e.mint, { mint: e.mint, ticker: e.ticker || e.mint.slice(0, 4), launchedAt: e.at, creator: e.creator, devPct: isFinite(devPct) ? devPct : 0, trades: [], last: e.price, lastAt: e.at, buys: 0 });
    this.prune(e.at);
  }

  private trade(t: FeedTrade) {
    let c = this.coins.get(t.mint);
    if (!c) {
      c = { mint: t.mint, ticker: t.ticker ?? t.mint.slice(0, 4), launchedAt: 0, creator: "", devPct: 0, trades: [], last: t.price, lastAt: t.at, buys: 0 };
      this.coins.set(t.mint, c);
    }
    c.trades.push({ at: t.at, price: t.price, sol: t.sol, isBuy: t.isBuy, trader: t.trader });
    if (c.trades.length > 400) c.trades.splice(0, c.trades.length - 400);
    c.last = t.price || c.last;
    c.lastAt = t.at;
    if (t.isBuy) {
      c.buys++;
      const wb = this.walletBuys.get(t.trader) ?? [];
      wb.push({ mint: t.mint, ticker: c.ticker, at: t.at, sol: t.sol });
      if (wb.length > 50) wb.shift();
      this.walletBuys.set(t.trader, wb);
    }
    for (const h of this.tradeHooks) h(t, c);
  }

  /** Drop coins we haven't heard from in an hour (but keep ones we hold). */
  prune(now: number, keep: Set<string> = new Set()) {
    for (const [m, c] of this.coins) if (!keep.has(m) && now - c.lastAt > 3_600_000 && now - c.launchedAt > 3_600_000) this.coins.delete(m);
  }

  price(mint: string) {
    return this.coins.get(mint)?.last ?? 0;
  }
  ticker(mint: string) {
    return this.coins.get(mint)?.ticker ?? mint.slice(0, 4);
  }

  /** 5-minute move for a coin, as a fraction (0.4 = +40%). */
  move5m(c: Coin, now: number) {
    const from = c.trades.find((t) => now - t.at <= WINDOW_MS);
    if (!from || !from.price) return 0;
    return c.last / from.price - 1;
  }

  /** Highest price seen since `since` (for trailing exits on "never" take-profit). */
  peakSince(mint: string, since: number) {
    const c = this.coins.get(mint);
    if (!c) return 0;
    let p = 0;
    for (const t of c.trades) if (t.at >= since && t.price > p) p = t.price;
    return p;
  }

  snapshot(now: number, positions: { mint: string; ticker: string; tokens: number; costSol: number; openedAt?: number; entryPrice?: number }[], copyWallet?: string): MarketSnapshot {
    const newLaunches = [...this.coins.values()]
      .filter((c) => c.launchedAt && now - c.launchedAt < 60_000)
      .sort((a, b) => b.launchedAt - a.launchedAt)
      .slice(0, 20)
      .map((c) => ({ mint: c.mint, ticker: c.ticker, ageBlocks: Math.max(0, Math.round((now - c.launchedAt) / SLOT_MS)), devPct: c.devPct }));
    const movers = [...this.coins.values()]
      .filter((c) => c.trades.length >= 3 && now - c.lastAt < WINDOW_MS)
      .map((c) => ({ mint: c.mint, ticker: c.ticker, move5m: this.move5m(c, now) }))
      .filter((m) => isFinite(m.move5m))
      .sort((a, b) => b.move5m - a.move5m)
      .slice(0, 20);
    const copyBuys = copyWallet
      ? (this.walletBuys.get(copyWallet) ?? []).filter((b) => now - b.at < 2 * 60_000).map((b) => ({ wallet: copyWallet, mint: b.mint, ticker: b.ticker }))
      : [];
    const pos = positions.map((p) => {
      const px = this.price(p.mint);
      const value = px * p.tokens;
      const peakPx = p.openedAt ? this.peakSince(p.mint, p.openedAt) : 0;
      const peak = p.entryPrice && peakPx ? peakPx / p.entryPrice : undefined;
      return { mint: p.mint, ticker: p.ticker, mult: p.costSol > 0 ? value / p.costSol : 1, size: value, peak };
    });
    return { newLaunches, movers, copyBuys, positions: pos };
  }
}

// ---------------------------------------------------------------- synthetic feed (offline dev / CI)

const NAMES = ["WIF", "BONK", "POPCAT", "MEW", "GOAT", "PNUT", "MOODENG", "CHILLGUY", "FWOG", "MICHI", "SIGMA", "GIGA", "LOCKIN", "AURA", "HOPPY", "PONKE", "SLERF", "BOME", "MYRO", "WEN", "TREMP", "SPX", "KITTY", "CHONK", "STAPLER", "SYNERGY", "KPI", "OOO"];
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = (r: Rng, n: number) => Array.from({ length: n }, () => B58[Math.floor(r() * B58.length)]).join("");

/**
 * Generates a plausible pump.fun tape: launches with a dev buy, then random
 * walks with momentum bursts and rugs. Same shape as the real feed, so the
 * rest of the stack cannot tell the difference. Used when BOSS_MARKET=synthetic
 * or when the websocket is unreachable.
 */
export class SyntheticFeed {
  private r: Rng;
  private live: { mint: string; ticker: string; price: number; vol: number; drift: number; born: number; dead: boolean }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private onEvent: (e: FeedEvent) => void, seed = 7, private wallets: string[] = []) {
    this.r = mulberry32(seed);
  }
  start(intervalMs = 400) {
    this.timer = setInterval(() => this.tick(Date.now()), intervalMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
  /** One step of the tape. Exposed for tests. */
  tick(now: number) {
    const r = this.r;
    if (this.live.length < 12 || r() < 0.08) {
      const price = 2.8e-8 * range(r, 0.9, 1.2); // pump.fun initial price ~2.8e-8 SOL
      const c = { mint: b58(r, 40) + "pump", ticker: pick(r, NAMES) + (r() < 0.3 ? Math.floor(r() * 99) : ""), price, vol: range(r, 0.02, 0.12), drift: range(r, -0.01, 0.02), born: now, dead: false };
      this.live.push(c);
      this.onEvent({ kind: "launch", mint: c.mint, ticker: c.ticker, name: c.ticker, creator: b58(r, 44), devBuySol: range(r, 0.1, 2), price, at: now });
    }
    for (const c of this.live) {
      if (c.dead || r() > 0.5) continue;
      // momentum burst / rug
      if (r() < 0.01) c.drift = range(r, 0.03, 0.1); // momentum burst
      if (r() < 0.004) c.drift = -0.25; // rug
      const ret = c.drift + (r() - 0.5) * c.vol;
      c.price = Math.max(1e-10, c.price * (1 + ret));
      c.drift *= 0.8;
      const isBuy = ret > 0 ? r() < 0.75 : r() < 0.35;
      const sol = range(r, 0.05, 3);
      const trader = this.wallets.length && r() < 0.15 ? pick(r, this.wallets) : b58(r, 44);
      this.onEvent({ kind: "trade", mint: c.mint, ticker: c.ticker, trader, isBuy, sol, tokens: sol / c.price, price: c.price, at: now });
      if (c.price < 5e-9 && r() < 0.05) c.dead = true;
    }
    this.live = this.live.filter((c) => !c.dead && now - c.born < 2 * 3_600_000).slice(-40);
  }
}
