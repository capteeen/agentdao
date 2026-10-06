// SQLite persistence for the world. Agents and votes are JSON documents keyed
// by id; trades / events / reports are append-only logs. A change log drives
// the SSE stream (/api/stream) so clients receive id-keyed patches.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Agent, BossEvent, ReportCard, Trade, Vote } from "../lib/types";
import { emptyWorld, type World } from "../lib/sim";
import { CFG } from "./config";

export interface Position {
  agentId: string;
  mint: string;
  ticker: string;
  tokens: number; // raw token units (6 decimals)
  costSol: number;
  openedAt: number;
  entryPrice: number; // SOL per token
  strategy: string;
  voteId: string; // vote that set the strategy that opened it
}

export interface Snapshot {
  voteId: string;
  mint: string;
  slot: number;
  supply: number;
  balances: Record<string, number>;
}

export interface AgentKey {
  agentId: string;
  publicKey: string;
  encrypted: string; // iv:tag:ciphertext (hex), AES-256-GCM
}

let db: Database.Database | null = null;

export function openDb(file = CFG.dbPath): Database.Database {
  if (db) return db;
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, born_at INTEGER, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS votes (id TEXT PRIMARY KEY, agent_id TEXT, status TEXT, ends_at INTEGER, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, agent_id TEXT, at INTEGER, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, at INTEGER, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, agent_id TEXT, at INTEGER, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS positions (agent_id TEXT, mint TEXT, json TEXT NOT NULL, PRIMARY KEY (agent_id, mint));
    CREATE TABLE IF NOT EXISTS snapshots (vote_id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ballots (vote_id TEXT, wallet TEXT, option TEXT, weight REAL, signature TEXT, at INTEGER, PRIMARY KEY (vote_id, wallet));
    CREATE TABLE IF NOT EXISTS ratings (report_id TEXT, wallet TEXT, up INTEGER, signature TEXT, PRIMARY KEY (report_id, wallet));
    CREATE TABLE IF NOT EXISTS keys (agent_id TEXT PRIMARY KEY, public_key TEXT NOT NULL, encrypted TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payouts (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, wallet TEXT, sol REAL, kind TEXT, at INTEGER, tx TEXT);
    CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, id TEXT, at INTEGER);
    CREATE INDEX IF NOT EXISTS trades_at ON trades(at DESC);
    CREATE INDEX IF NOT EXISTS events_at ON events(at DESC);
    CREATE INDEX IF NOT EXISTS reports_at ON reports(at DESC);
    CREATE INDEX IF NOT EXISTS votes_status ON votes(status, ends_at);
  `);
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
}

const J = <T>(row: { json: string } | undefined): T | undefined => (row ? (JSON.parse(row.json) as T) : undefined);

// ---------------------------------------------------------------- kv

export function getKv<T>(k: string, d: T): T {
  const row = openDb().prepare("SELECT v FROM kv WHERE k=?").get(k) as { v: string } | undefined;
  return row ? (JSON.parse(row.v) as T) : d;
}
export function setKv(k: string, v: unknown) {
  openDb().prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, JSON.stringify(v));
}

// ---------------------------------------------------------------- world

export function loadWorld(limits = { trades: 2000, events: 300, reports: 600 }): World {
  const d = openDb();
  const w = emptyWorld();
  for (const r of d.prepare("SELECT json FROM agents").all() as { json: string }[]) {
    const a = JSON.parse(r.json) as Agent;
    w.agents[a.id] = a;
  }
  for (const r of d.prepare("SELECT json FROM votes").all() as { json: string }[]) {
    const v = JSON.parse(r.json) as Vote;
    w.votes[v.id] = v;
  }
  w.trades = (d.prepare("SELECT json FROM trades ORDER BY at DESC LIMIT ?").all(limits.trades) as { json: string }[]).map((r) => JSON.parse(r.json) as Trade);
  w.events = (d.prepare("SELECT json FROM events ORDER BY at DESC LIMIT ?").all(limits.events) as { json: string }[]).map((r) => JSON.parse(r.json) as BossEvent);
  w.reports = (d.prepare("SELECT json FROM reports ORDER BY at DESC LIMIT ?").all(limits.reports) as { json: string }[]).map((r) => JSON.parse(r.json) as ReportCard);
  w.slot = getKv("slot", 0);
  w.seq = getKv("seq", 0);
  w.nextAgentNo = getKv("nextAgentNo", 1);
  return w;
}

const upsertAgent = () => openDb().prepare("INSERT INTO agents(id,born_at,json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json");
const upsertVote = () => openDb().prepare("INSERT INTO votes(id,agent_id,status,ends_at,json) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, ends_at=excluded.ends_at, json=excluded.json");
const insTrade = () => openDb().prepare("INSERT OR IGNORE INTO trades(id,agent_id,at,json) VALUES(?,?,?,?)");
const insEvent = () => openDb().prepare("INSERT OR IGNORE INTO events(id,at,json) VALUES(?,?,?)");
const insReport = () => openDb().prepare("INSERT OR IGNORE INTO reports(id,agent_id,at,json) VALUES(?,?,?,?)");
const insChange = () => openDb().prepare("INSERT INTO changes(kind,id,at) VALUES(?,?,?)");

/**
 * Persist the difference between two world states. The sim functions produce
 * new object identities for anything they touch, so identity comparison is a
 * cheap and exact change detector.
 */
export function persistDiff(prev: World, next: World, now = Date.now()) {
  const d = openDb();
  const tx = d.transaction(() => {
    const ua = upsertAgent(),
      uv = upsertVote(),
      it = insTrade(),
      ie = insEvent(),
      ir = insReport(),
      ic = insChange();
    for (const a of Object.values(next.agents)) {
      if (prev.agents[a.id] === a) continue;
      ua.run(a.id, a.bornAt, JSON.stringify(a));
      ic.run("agent", a.id, now);
    }
    for (const v of Object.values(next.votes)) {
      if (prev.votes[v.id] === v) continue;
      uv.run(v.id, v.agentId, v.status, v.endsAt, JSON.stringify(v));
      ic.run("vote", v.id, now);
    }
    if (next.trades !== prev.trades) {
      const top = prev.trades[0]?.id;
      for (const t of next.trades) {
        if (t.id === top) break;
        it.run(t.id, t.agentId, t.at, JSON.stringify(t));
        ic.run("trade", t.id, now);
      }
    }
    if (next.events !== prev.events) {
      const top = prev.events[0]?.id;
      for (const e of next.events) {
        if (e.id === top) break;
        ie.run(e.id, e.at, JSON.stringify(e));
        ic.run("event", e.id, now);
      }
    }
    if (next.reports !== prev.reports) {
      const top = prev.reports[0]?.id;
      for (const r of next.reports) {
        if (r.id === top) break;
        ir.run(r.id, r.agentId, r.at, JSON.stringify(r));
        ic.run("report", r.id, now);
      }
    }
    setKv("slot", next.slot);
    setKv("seq", next.seq);
    setKv("nextAgentNo", next.nextAgentNo);
    // trim the change log
    d.prepare("DELETE FROM changes WHERE seq < (SELECT COALESCE(MAX(seq),0) - 5000 FROM changes)").run();
  });
  tx();
}

/** Overwrite a single report (ratings). */
export function saveReport(r: ReportCard) {
  openDb().prepare("INSERT INTO reports(id,agent_id,at,json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(r.id, r.agentId, r.at, JSON.stringify(r));
  insChange().run("report", r.id, Date.now());
}
export function getReport(id: string) {
  return J<ReportCard>(openDb().prepare("SELECT json FROM reports WHERE id=?").get(id) as { json: string } | undefined);
}
export function getAgent(id: string) {
  return J<Agent>(openDb().prepare("SELECT json FROM agents WHERE id=?").get(id) as { json: string } | undefined);
}
export function getVote(id: string) {
  return J<Vote>(openDb().prepare("SELECT json FROM votes WHERE id=?").get(id) as { json: string } | undefined);
}
export function saveVote(v: Vote) {
  upsertVote().run(v.id, v.agentId, v.status, v.endsAt, JSON.stringify(v));
  insChange().run("vote", v.id, Date.now());
}
export function saveAgent(a: Agent) {
  upsertAgent().run(a.id, a.bornAt, JSON.stringify(a));
  insChange().run("agent", a.id, Date.now());
}
export function addEvent(e: BossEvent) {
  insEvent().run(e.id, e.at, JSON.stringify(e));
  insChange().run("event", e.id, Date.now());
}

// ---------------------------------------------------------------- change feed (SSE)

export interface Patch {
  seq: number;
  world: Partial<World>;
}

export function latestSeq(): number {
  const r = openDb().prepare("SELECT COALESCE(MAX(seq),0) s FROM changes").get() as { s: number };
  return r.s;
}

/** Everything that changed after `seq`, as an id-keyed patch. */
export function changesSince(seq: number): Patch {
  const d = openDb();
  const rows = d.prepare("SELECT seq, kind, id FROM changes WHERE seq > ? ORDER BY seq").all(seq) as { seq: number; kind: string; id: string }[];
  const world: Partial<World> = {};
  const seen = new Set<string>();
  let last = seq;
  for (const r of rows) {
    last = r.seq;
    const key = r.kind + ":" + r.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.kind === "agent") {
      const a = getAgent(r.id);
      if (a) (world.agents ??= {})[a.id] = a;
    } else if (r.kind === "vote") {
      const v = getVote(r.id);
      if (v) (world.votes ??= {})[v.id] = v;
    } else if (r.kind === "trade") {
      const t = J<Trade>(d.prepare("SELECT json FROM trades WHERE id=?").get(r.id) as { json: string } | undefined);
      if (t) (world.trades ??= []).push(t);
    } else if (r.kind === "event") {
      const e = J<BossEvent>(d.prepare("SELECT json FROM events WHERE id=?").get(r.id) as { json: string } | undefined);
      if (e) (world.events ??= []).push(e);
    } else if (r.kind === "report") {
      const rep = getReport(r.id);
      if (rep) (world.reports ??= []).push(rep);
    }
  }
  if (rows.length) world.slot = getKv("slot", 0);
  // logs are newest-first on the client
  world.trades?.sort((a, b) => b.at - a.at);
  world.events?.sort((a, b) => b.at - a.at);
  world.reports?.sort((a, b) => b.at - a.at);
  return { seq: last, world };
}

// ---------------------------------------------------------------- positions / snapshots / ballots / keys / payouts

export function getPositions(agentId: string): Position[] {
  return (openDb().prepare("SELECT json FROM positions WHERE agent_id=?").all(agentId) as { json: string }[]).map((r) => JSON.parse(r.json) as Position);
}
export function allPositions(): Position[] {
  return (openDb().prepare("SELECT json FROM positions").all() as { json: string }[]).map((r) => JSON.parse(r.json) as Position);
}
export function savePosition(p: Position) {
  openDb().prepare("INSERT INTO positions(agent_id,mint,json) VALUES(?,?,?) ON CONFLICT(agent_id,mint) DO UPDATE SET json=excluded.json").run(p.agentId, p.mint, JSON.stringify(p));
}
export function deletePosition(agentId: string, mint: string) {
  openDb().prepare("DELETE FROM positions WHERE agent_id=? AND mint=?").run(agentId, mint);
}

export function saveSnapshot(s: Snapshot) {
  openDb().prepare("INSERT INTO snapshots(vote_id,json) VALUES(?,?) ON CONFLICT(vote_id) DO UPDATE SET json=excluded.json").run(s.voteId, JSON.stringify(s));
}
export function getSnapshot(voteId: string) {
  return J<Snapshot>(openDb().prepare("SELECT json FROM snapshots WHERE vote_id=?").get(voteId) as { json: string } | undefined);
}

export function hasBallot(voteId: string, wallet: string) {
  return !!openDb().prepare("SELECT 1 FROM ballots WHERE vote_id=? AND wallet=?").get(voteId, wallet);
}
export function saveBallot(b: { voteId: string; wallet: string; option: string; weight: number; signature: string; at: number }) {
  openDb().prepare("INSERT INTO ballots(vote_id,wallet,option,weight,signature,at) VALUES(?,?,?,?,?,?)").run(b.voteId, b.wallet, b.option, b.weight, b.signature, b.at);
}
export function hasRating(reportId: string, wallet: string) {
  return !!openDb().prepare("SELECT 1 FROM ratings WHERE report_id=? AND wallet=?").get(reportId, wallet);
}
export function saveRating(reportId: string, wallet: string, up: boolean, signature: string) {
  openDb().prepare("INSERT INTO ratings(report_id,wallet,up,signature) VALUES(?,?,?,?)").run(reportId, wallet, up ? 1 : 0, signature);
}

export function saveKey(k: AgentKey) {
  openDb().prepare("INSERT INTO keys(agent_id,public_key,encrypted) VALUES(?,?,?)").run(k.agentId, k.publicKey, k.encrypted);
}
export function getKey(agentId: string): AgentKey | undefined {
  const r = openDb().prepare("SELECT agent_id agentId, public_key publicKey, encrypted FROM keys WHERE agent_id=?").get(agentId) as AgentKey | undefined;
  return r;
}

export function savePayout(p: { agentId: string; wallet: string; sol: number; kind: "fees" | "liquidation"; at: number; tx?: string }) {
  openDb().prepare("INSERT INTO payouts(agent_id,wallet,sol,kind,at,tx) VALUES(?,?,?,?,?,?)").run(p.agentId, p.wallet, p.sol, p.kind, p.at, p.tx ?? null);
}
export function payoutsFor(wallet: string) {
  return openDb().prepare("SELECT agent_id agentId, sol, kind, at, tx FROM payouts WHERE wallet=? ORDER BY at DESC LIMIT 100").all(wallet) as { agentId: string; sol: number; kind: string; at: number; tx: string | null }[];
}
export function unclaimedFees(wallet: string): Record<string, number> {
  // Phase 2 simplification: fee shares are pushed, not pulled; "claimable" is what was paid in the last 24h.
  const rows = openDb().prepare("SELECT agent_id agentId, SUM(sol) sol FROM payouts WHERE wallet=? AND kind='fees' AND at > ? GROUP BY agent_id").all(wallet, Date.now() - 86_400_000) as { agentId: string; sol: number }[];
  return Object.fromEntries(rows.map((r) => [r.agentId, r.sol]));
}
