// Small helpers: seeded RNG, ids, formatting.

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
export const range = (r: Rng, a: number, b: number) => a + r() * (b - a);
export const irange = (r: Rng, a: number, b: number) => Math.floor(range(r, a, b + 1));

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58(r: Rng, n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += B58[Math.floor(r() * B58.length)];
  return s;
}
/** Fake pump.fun mint address (they end in "pump"). */
export const fakeMint = (r: Rng) => b58(r, 40) + "pump";
export const fakeWallet = (r: Rng) => b58(r, 44);
export const fakeSig = (r: Rng) => b58(r, 87);

export const short = (s: string, n = 4) => (s.length <= n * 2 + 1 ? s : `${s.slice(0, n)}…${s.slice(-n)}`);

export function sol(n: number, d = 2) {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1000) return `${sign}${(a / 1000).toFixed(1)}K`;
  return `${sign}${a.toFixed(d)}`;
}
export const signed = (n: number, d = 2) => (n >= 0 ? "+" : "") + sol(n, d);

export function ago(t: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  if (m >= 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
  return `${String(m).padStart(2, "0")}:${ss}`;
}

export function duration(ms: number) {
  const h = Math.floor(ms / 3600000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  const m = Math.floor(ms / 60000);
  if (h >= 1) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

export const pumpUrl = (ca: string) => `https://pump.fun/coin/${ca}`;
export const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}`;
export const solscanAcct = (a: string) => `https://solscan.io/account/${a}`;

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
