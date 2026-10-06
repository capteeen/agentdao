// Seed a paper-mode world so the floor isn't empty on first run.
//   npx tsx scripts/seed.ts            (25 demo agents, like the Phase 1 mock)
//   npx tsx scripts/seed.ts --reset    (wipe first)
import fs from "node:fs";
import { CFG } from "../server/config";
import { closeDb, openDb, persistDiff } from "../server/db";
import { createWorld, emptyWorld, agentList } from "../lib/sim";

if (process.argv.includes("--reset") && CFG.dbPath !== ":memory:") for (const f of [CFG.dbPath, CFG.dbPath + "-wal", CFG.dbPath + "-shm"]) fs.rmSync(f, { force: true });
openDb();
const now = Date.now();
const w = createWorld(1337, now);
// Seeded votes are closed already; the worker opens real ones from proposals.
for (const v of Object.values(w.votes)) if (v.status === "live") w.votes[v.id] = { ...v, status: "failed", closeSlot: w.slot };
for (const a of agentList(w)) w.agents[a.id] = { ...a, nextTradeAt: undefined };
persistDiff(emptyWorld(), w, now);
closeDb();
console.log(`seeded ${agentList(w).length} agents into ${CFG.dbPath}`);
