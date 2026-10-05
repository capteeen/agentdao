// Immediate-mode voxel scene description for the office.
//
// Every frame we describe the office as a flat list of axis-aligned boxes
// (position, size, colour). The Three.js renderer feeds them to a single
// InstancedMesh; the 2D fallback draws them as isometric polygons. One scene
// function, two renderers.

import type { Agent, Vote } from "../types";
import { RISK_COLOR } from "../rules";

export interface Box {
  x: number; // centre
  y: number; // bottom
  z: number; // centre
  w: number;
  h: number;
  d: number;
  c: number; // 0xRRGGBB
  glass?: boolean;
}

export type WorkerState = "typing" | "phone" | "asleep" | "sweating" | "corner" | "fired" | "gone";

export interface Memo {
  voteId: string;
  agentId: string;
  at: number; // ms timestamp of pass
  fire?: boolean;
}

export interface Layout {
  slots: Map<string, { x: number; z: number; corner: boolean }>;
  width: number; // floor extents
  depth: number;
  boardroom: { x: number; z: number };
  door: { x: number; z: number };
  corner: { x: number; z: number };
}

export const C = {
  floor: 0x2a2520,
  floor2: 0x312b25,
  carpet: 0x23324a,
  wall: 0x3a332c,
  wallTop: 0x4a4038,
  desk: 0x8a5a36,
  deskTop: 0xa8703f,
  monitor: 0x1b1815,
  screen: 0x4a90e2,
  screenOff: 0x22303f,
  chair: 0x2f2f3a,
  skin: 0xf1c27d,
  shirt: 0xf4f4f2,
  pants: 0x2c3e50,
  tie: 0xe63946,
  memo: 0xf5e663,
  stamp: 0xe63946,
  ok: 0x7bd389,
  box: 0xc8a165,
  glass: 0x9fd8ff,
  boardTable: 0x5b3a22,
  lamp: 0xf5e663,
  lampOff: 0x5a5236,
  door: 0x6b4a2e,
  plant: 0x3f8f4f,
  pot: 0xb5651d,
  sweat: 0x8fd3ff,
  zzz: 0xf4f4f2,
  phone: 0x111111,
};

const CELL = 3.2;
const COLS_MIN = 5;

/** Desk slots: employed agents on a grid, top earner in the glass corner office. */
export function computeLayout(agents: Agent[], topId: string | undefined, now: number): Layout {
  const onFloor = agents.filter((a) => a.status === "working" || a.status === "idle" || ((a.status === "fired" || a.status === "bankrupt") && a.firedAt && now - a.firedAt < 9000));
  const n = Math.max(1, onFloor.length);
  const cols = Math.max(COLS_MIN, Math.ceil(Math.sqrt(n * 1.4)));
  const rows = Math.ceil((n + 1) / cols); // +1: the corner office takes a cell
  const width = cols * CELL + 4;
  const depth = rows * CELL + 9; // room for boardroom at back
  const slots = new Map<string, { x: number; z: number; corner: boolean }>();
  const corner = { x: width / 2 - 2.6, z: depth / 2 - 2.6 };
  let i = 0;
  // stable order by birth so desks don't shuffle around
  const ordered = [...onFloor].sort((a, b) => a.bornAt - b.bornAt || a.id.localeCompare(b.id));
  for (const a of ordered) {
    if (a.id === topId) {
      slots.set(a.id, { x: corner.x, z: corner.z, corner: true });
      continue;
    }
    let x = 0,
      z = 0;
    for (;;) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      i++;
      x = -width / 2 + 2 + c * CELL + CELL / 2;
      z = -depth / 2 + 8 + r * CELL + CELL / 2;
      if (!(Math.abs(x - corner.x) < 3.5 && Math.abs(z - corner.z) < 3.5)) break;
    }
    slots.set(a.id, { x, z, corner: false });
  }
  return { slots, width: width + 2, depth, boardroom: { x: -width / 2 + 5, z: -depth / 2 + 3 }, door: { x: width / 2 + 1, z: -depth / 2 + 5.5 }, corner };
}

export function workerState(a: Agent, now: number, topId?: string): WorkerState {
  if (a.status === "fired" || a.status === "bankrupt") return a.firedAt && now - a.firedAt < 9000 ? "fired" : "gone";
  if (a.status === "idle") return "asleep";
  if (a.lastAction?.kind === "launch" && now - a.lastAction.at < 6000) return "phone";
  if (a.lossStreak >= 3) return "sweating";
  if (a.id === topId) return "corner";
  return "typing";
}

/** Desk size grows with vault (log scale). */
export const deskScale = (vault: number) => 1 + Math.min(1, Math.log10(1 + Math.max(0, vault)) / 2.3);

// ------------------------------------------------------------------ static

export function staticBoxes(L: Layout): Box[] {
  const out: Box[] = [];
  const { width: W, depth: D } = L;
  // floor tiles (checker, 2x2 tiles)
  const T = 2;
  for (let x = -W / 2; x < W / 2; x += T)
    for (let z = -D / 2; z < D / 2; z += T) {
      const odd = (Math.round(x / T) + Math.round(z / T)) & 1;
      out.push({ x: x + T / 2, y: -0.3, z: z + T / 2, w: T, h: 0.3, d: T, c: odd ? C.floor : C.floor2 });
    }
  // back + left walls
  out.push({ x: 0, y: 0, z: -D / 2 - 0.25, w: W, h: 3.2, d: 0.5, c: C.wall });
  out.push({ x: 0, y: 3.2, z: -D / 2 - 0.25, w: W, h: 0.25, d: 0.6, c: C.wallTop });
  out.push({ x: -W / 2 - 0.25, y: 0, z: 0, w: 0.5, h: 3.2, d: D + 0.5, c: C.wall });
  out.push({ x: -W / 2 - 0.25, y: 3.2, z: 0, w: 0.6, h: 0.25, d: D + 0.5, c: C.wallTop });
  // windows on back wall
  for (let x = -W / 2 + 12; x < W / 2 - 2; x += 4) out.push({ x, y: 1.3, z: -D / 2 + 0.02, w: 2.4, h: 1.3, d: 0.1, c: 0x4a6f9a });
  // boardroom carpet + glass partition
  const B = L.boardroom;
  out.push({ x: B.x, y: -0.05, z: B.z, w: 8, h: 0.08, d: 5, c: C.carpet });
  out.push({ x: B.x + 4, y: 0, z: B.z, w: 0.12, h: 2.4, d: 5, c: C.glass, glass: true });
  out.push({ x: B.x, y: 0, z: B.z + 2.5, w: 5, h: 2.4, d: 0.12, c: C.glass, glass: true });
  // boardroom table + chairs
  out.push({ x: B.x, y: 0, z: B.z, w: 5, h: 0.8, d: 1.6, c: C.boardTable });
  out.push({ x: B.x, y: 0.8, z: B.z, w: 5.2, h: 0.12, d: 1.8, c: 0x6e4a2e });
  for (let k = -2; k <= 2; k++) {
    out.push({ x: B.x + k * 1.1, y: 0, z: B.z - 1.35, w: 0.6, h: 0.6, d: 0.6, c: C.chair });
    out.push({ x: B.x + k * 1.1, y: 0, z: B.z + 1.35, w: 0.6, h: 0.6, d: 0.6, c: C.chair });
  }
  // door on right side of back
  out.push({ x: L.door.x - 0.3, y: 0, z: L.door.z, w: 0.3, h: 2.6, d: 1.6, c: C.door });
  out.push({ x: L.door.x - 0.5, y: 1.2, z: L.door.z + 0.5, w: 0.1, h: 0.15, d: 0.15, c: C.memo });
  // corner office glass walls
  const K = L.corner;
  out.push({ x: K.x - 2.4, y: 0, z: K.z, w: 0.12, h: 2.2, d: 4.8, c: C.glass, glass: true });
  out.push({ x: K.x, y: 0, z: K.z - 2.4, w: 4.8, h: 2.2, d: 0.12, c: C.glass, glass: true });
  out.push({ x: K.x, y: -0.04, z: K.z, w: 4.8, h: 0.06, d: 4.8, c: 0x4a2a2a });
  // plants
  for (const [px, pz] of [
    [-W / 2 + 1, D / 2 - 1],
    [W / 2 - 6, -D / 2 + 1],
    [-W / 2 + 10, -D / 2 + 1],
  ]) {
    out.push({ x: px, y: 0, z: pz, w: 0.7, h: 0.6, d: 0.7, c: C.pot });
    out.push({ x: px, y: 0.6, z: pz, w: 0.9, h: 0.9, d: 0.9, c: C.plant });
    out.push({ x: px, y: 1.5, z: pz, w: 0.5, h: 0.5, d: 0.5, c: 0x56b36a });
  }
  // water cooler
  out.push({ x: W / 2 - 1, y: 0, z: -D / 2 + 9, w: 0.7, h: 1.1, d: 0.7, c: 0xdddddd });
  out.push({ x: W / 2 - 1, y: 1.1, z: -D / 2 + 9, w: 0.55, h: 0.7, d: 0.55, c: 0x7fc4ff, glass: true });
  return out;
}

// ------------------------------------------------------------------ dynamic

function hexToNum(h: string) {
  return parseInt(h.slice(1), 16);
}
function mix(a: number, b: number, f: number) {
  const ch = (s: number) => Math.round(((a >> s) & 255) * f + ((b >> s) & 255) * (1 - f));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Person made of voxels. (x,z) = feet centre, facing -z (towards the monitor). */
function person(out: Box[], x: number, z: number, t: number, state: WorkerState, shirt: number, seated: boolean, facing = -1) {
  const y0 = seated ? 0.45 : 0;
  const bob = state === "typing" || state === "corner" ? Math.abs(Math.sin(t * 9)) * 0.03 : 0;
  // legs
  if (!seated) {
    const swing = Math.sin(t * 10) * 0.18;
    out.push({ x: x - 0.14, y: 0, z: z + swing, w: 0.2, h: 0.55, d: 0.22, c: C.pants });
    out.push({ x: x + 0.14, y: 0, z: z - swing, w: 0.2, h: 0.55, d: 0.22, c: C.pants });
  } else {
    out.push({ x, y: y0, z: z + facing * 0.25, w: 0.5, h: 0.2, d: 0.5, c: C.pants });
  }
  const by = (seated ? y0 + 0.15 : 0.55) + bob;
  // torso + tie
  out.push({ x, y: by, z, w: 0.6, h: 0.6, d: 0.36, c: shirt });
  out.push({ x, y: by + 0.12, z: z + facing * 0.19, w: 0.1, h: 0.42, d: 0.02, c: C.tie });
  // head
  const hy = by + 0.6;
  const nod = state === "asleep" ? -0.12 : 0;
  out.push({ x, y: hy + nod, z: z + (state === "asleep" ? facing * 0.12 : 0), w: 0.44, h: 0.44, d: 0.44, c: C.skin });
  out.push({ x, y: hy + 0.38 + nod, z, w: 0.46, h: 0.1, d: 0.46, c: 0x3b2a1a }); // hair
  if (state !== "asleep") {
    const ez = z + facing * 0.225;
    out.push({ x: x - 0.1, y: hy + 0.2, z: ez, w: 0.08, h: 0.08, d: 0.01, c: 0x1b1815 });
    out.push({ x: x + 0.1, y: hy + 0.2, z: ez, w: 0.08, h: 0.08, d: 0.01, c: 0x1b1815 });
  }
  // arms
  if (state === "typing" || state === "corner" || state === "sweating") {
    const sp = state === "sweating" ? 22 : 14;
    const a1 = Math.sin(t * sp) * 0.06;
    const a2 = Math.sin(t * sp + 2) * 0.06;
    out.push({ x: x - 0.36, y: by + 0.3 + a1, z: z + facing * 0.3, w: 0.14, h: 0.14, d: 0.5, c: shirt });
    out.push({ x: x + 0.36, y: by + 0.3 + a2, z: z + facing * 0.3, w: 0.14, h: 0.14, d: 0.5, c: shirt });
  } else if (state === "phone") {
    out.push({ x: x - 0.36, y: by + 0.25, z: z + facing * 0.25, w: 0.14, h: 0.14, d: 0.45, c: shirt });
    out.push({ x: x + 0.3, y: by + 0.4, z, w: 0.14, h: 0.5, d: 0.14, c: shirt });
    out.push({ x: x + 0.27, y: hy + 0.05, z: z + facing * 0.05, w: 0.08, h: 0.35, d: 0.12, c: C.phone });
  } else if (state === "fired") {
    // carrying a cardboard box in front
    out.push({ x: x - 0.32, y: by + 0.25, z: z + facing * 0.3, w: 0.12, h: 0.12, d: 0.45, c: shirt });
    out.push({ x: x + 0.32, y: by + 0.25, z: z + facing * 0.3, w: 0.12, h: 0.12, d: 0.45, c: shirt });
    out.push({ x, y: by + 0.15, z: z + facing * 0.55, w: 0.7, h: 0.5, d: 0.5, c: C.box });
    out.push({ x: x - 0.1, y: by + 0.65, z: z + facing * 0.55, w: 0.18, h: 0.18, d: 0.08, c: C.plant }); // sad plant
  } else {
    out.push({ x: x - 0.36, y: by + 0.05, z, w: 0.14, h: 0.5, d: 0.14, c: shirt });
    out.push({ x: x + 0.36, y: by + 0.05, z, w: 0.14, h: 0.5, d: 0.14, c: shirt });
  }
  // state FX
  if (state === "sweating") {
    const p = (t * 1.6) % 1;
    out.push({ x: x + 0.3, y: hy + 0.35 - p * 0.6, z: z + facing * -0.05, w: 0.08, h: 0.12, d: 0.08, c: C.sweat });
    out.push({ x: x - 0.3, y: hy + 0.3 - ((p + 0.5) % 1) * 0.6, z, w: 0.08, h: 0.12, d: 0.08, c: C.sweat });
  }
  if (state === "asleep") {
    for (let k = 0; k < 3; k++) {
      const p = (t * 0.5 + k / 3) % 1;
      const s = 0.08 + p * 0.12;
      out.push({ x: x + 0.3 + p * 0.5, y: hy + 0.6 + p * 1.0, z, w: s, h: s, d: 0.04, c: C.zzz });
    }
  }
}

export interface DynOpts {
  agents: Agent[];
  liveVotes: Vote[];
  memos: Memo[];
  topId?: string;
  now: number;
  t: number; // seconds, for animation
  hoverId?: string | null;
}

export function dynamicBoxes(L: Layout, o: DynOpts): Box[] {
  const out: Box[] = [];
  const { now, t } = o;
  const B = L.boardroom;
  const live = o.liveVotes.length > 0;
  // Boardroom lights: pulse when a vote is live.
  const pulse = live ? (Math.sin(t * 4) > 0 ? C.lamp : 0xffd84a) : C.lampOff;
  for (let k = -1; k <= 1; k++) {
    out.push({ x: B.x + k * 1.8, y: 2.7, z: B.z, w: 0.9, h: 0.15, d: 0.9, c: pulse });
  }
  // board members when vote live
  if (live) {
    for (let k = -2; k <= 2; k += 2) {
      const bob = Math.abs(Math.sin(t * 3 + k)) * 0.05;
      out.push({ x: B.x + k * 1.1, y: 0.6, z: B.z - 1.35, w: 0.5, h: 0.55 + bob, d: 0.36, c: 0x2c3e50 });
      out.push({ x: B.x + k * 1.1, y: 1.15 + bob, z: B.z - 1.35, w: 0.38, h: 0.38, d: 0.38, c: C.skin });
    }
    // live "VOTE" sign: tally bars on wall
    const v = o.liveVotes[0];
    const total = Object.values(v.tallies).reduce((s, x) => s + x, 0) || 1;
    v.options.forEach((opt, i) => {
      const h = 0.1 + (v.tallies[opt] / total) * 1.4;
      out.push({ x: B.x - 1.6 + i * 0.7, y: 1.0, z: B.z - 2.45, w: 0.5, h, d: 0.08, c: [0x4a90e2, 0xf5e663, 0xe63946, 0x7bd389][i % 4] });
    });
  }

  for (const a of o.agents) {
    const slot = L.slots.get(a.id);
    if (!slot) continue;
    const st = workerState(a, now, o.topId);
    if (st === "gone") continue;
    const ds = deskScale(a.vault);
    const dw = 1.5 * ds;
    const { x, z } = slot;
    const hover = o.hoverId === a.id;
    // risk-coloured floor mat (shows the current order at a glance)
    const recent = a.lastOrderAt && now - a.lastOrderAt < 2500;
    out.push({ x, y: -0.02, z: z - 0.1, w: dw + 0.5, h: 0.04, d: 2.1, c: recent ? (Math.sin(t * 20) > 0 ? C.ok : C.memo) : hover ? 0xf4f4f2 : mix(hexToNum(RISK_COLOR[a.rules.risk]), C.floor, 0.45) });
    if (st !== "fired") {
      // Desk faces the camera: worker sits behind it (towards -z) facing +z,
      // laptop lid towards the viewer so the face stays visible.
      out.push({ x, y: 0, z: z + 0.3, w: dw, h: 0.72, d: 0.9, c: C.desk });
      out.push({ x, y: 0.72, z: z + 0.3, w: dw + 0.1, h: 0.1, d: 1.0, c: C.deskTop });
      const screenOn = st !== "asleep";
      const flick = st === "typing" || st === "corner" ? (Math.sin(t * 6 + a.seed) > 0.85 ? C.ok : C.screen) : st === "sweating" ? (Math.sin(t * 8) > 0 ? C.stamp : C.screen) : C.screen;
      // laptop: base + lid (lid glows on the side facing the worker; we see its back + a logo)
      out.push({ x, y: 0.82, z: z + 0.15, w: 0.7, h: 0.04, d: 0.45, c: 0x555555 });
      out.push({ x, y: 0.86, z: z + 0.42, w: 0.7, h: 0.42, d: 0.05, c: 0x6b6b6b });
      out.push({ x, y: 1.0, z: z + 0.45, w: 0.14, h: 0.14, d: 0.02, c: screenOn ? flick : C.screenOff });
      // screen glow on the worker's face side
      if (screenOn) out.push({ x, y: 0.88, z: z + 0.39, w: 0.62, h: 0.36, d: 0.01, c: flick });
      // big desk: stacks of cash (SOL) on the side
      if (ds > 1.35) {
        const stacks = Math.min(4, Math.floor((ds - 1.2) * 6));
        for (let k = 0; k < stacks; k++) out.push({ x: x + dw / 2 - 0.25, y: 0.82 + k * 0.08, z: z + 0.45, w: 0.35, h: 0.07, d: 0.2, c: k % 2 ? 0x9945ff : 0x14f195 });
      }
      // desk phone + mug
      out.push({ x: x - dw / 2 + 0.25, y: 0.82, z: z + 0.45, w: 0.25, h: 0.1, d: 0.2, c: C.phone });
      if (st === "phone" && Math.sin(t * 30) > 0) out.push({ x: x - dw / 2 + 0.25, y: 0.95, z: z + 0.45, w: 0.08, h: 0.08, d: 0.08, c: C.memo });
      out.push({ x: x + dw / 2 - 0.2, y: 0.82, z: z + 0.05, w: 0.14, h: 0.16, d: 0.14, c: a.seed % 2 ? 0xe63946 : 0xf4f4f2 });
      // chair behind the worker
      out.push({ x, y: 0, z: z - 0.45, w: 0.6, h: 0.45, d: 0.6, c: C.chair });
      out.push({ x, y: 0.45, z: z - 0.75, w: 0.6, h: 0.75, d: 0.12, c: C.chair });
      // worker
      const shirt = st === "corner" ? 0x2b2b2b : a.seed % 3 === 0 ? 0xdfe9f5 : a.seed % 3 === 1 ? C.shirt : 0xd9ecd9;
      person(out, x, z - 0.4, t + (a.seed % 100) / 13, st, shirt, true, 1);
      // corner office: trophy
      if (st === "corner") out.push({ x: x - dw / 2 + 0.6, y: 0.82, z: z + 0.5, w: 0.2, h: 0.35, d: 0.2, c: 0xffd700 });
    } else {
      // fired: desk cleared (just the frame), worker walks to the door with a box
      out.push({ x, y: 0, z: z + 0.3, w: dw, h: 0.72, d: 0.9, c: 0x5a4636 });
      const p = Math.min(1, (now - (a.firedAt ?? now)) / 8000);
      const wx = x + (L.door.x - 1.2 - x) * p;
      const wz = z - 0.4 + (L.door.z - z + 0.4) * Math.min(1, p * 1.4);
      if (p < 0.98) person(out, wx, wz, t, "fired", C.shirt, false, -1);
      // box drop dust at the end
    }
    // hover beacon
    if (hover) out.push({ x, y: 2.4 + Math.sin(t * 4) * 0.1, z: z - 0.4, w: 0.25, h: 0.25, d: 0.25, c: C.memo });
  }

  // Flying memos: boardroom -> desk, then stamp.
  for (const m of o.memos) {
    const slot = L.slots.get(m.agentId);
    if (!slot) continue;
    const age = (now - m.at) / 1000;
    const FLY = 1.6;
    if (age < 0 || age > FLY + 1.6) continue;
    const p = Math.min(1, age / FLY);
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const sx = B.x,
      sz = B.z,
      sy = 1.2;
    const tx = slot.x,
      tz = slot.z + 0.15,
      ty = 0.85;
    const mx = sx + (tx - sx) * e;
    const mz = sz + (tz - sz) * e;
    const my = sy + (ty - sy) * e + Math.sin(Math.PI * e) * 4;
    const flap = age < FLY ? Math.sin(t * 25) * 0.08 : 0;
    out.push({ x: mx, y: my + flap, z: mz, w: 1.1, h: 0.06, d: 1.4, c: C.memo });
    for (let k = -1; k <= 1; k++) out.push({ x: mx, y: my + flap + 0.06, z: mz + k * 0.35, w: 0.8, h: 0.01, d: 0.08, c: 0x8a7f2a });
    // sparkle trail while flying
    if (age < FLY)
      for (let k = 1; k <= 4; k++) {
        const pe = Math.max(0, e - k * 0.05);
        const ty2 = sy + (ty - sy) * pe + Math.sin(Math.PI * pe) * 4;
        const sz2 = 0.3 - k * 0.05;
        out.push({ x: sx + (tx - sx) * pe, y: ty2, z: sz + (tz - sz) * pe, w: sz2, h: sz2, d: sz2, c: k % 2 ? C.memo : 0xffffff });
      }
    if (age >= FLY) {
      // stamp slams down
      const sp = Math.min(1, (age - FLY) / 0.25);
      const stampY = ty + 0.05 + (1 - sp) * 1.2;
      out.push({ x: tx, y: stampY + 0.3, z: tz, w: 0.3, h: 0.4, d: 0.3, c: 0x5b3a22 });
      out.push({ x: tx, y: stampY, z: tz, w: 0.5, h: 0.3, d: 0.4, c: m.fire ? C.stamp : C.stamp });
      if (sp >= 1) out.push({ x: tx, y: ty + 0.045, z: tz, w: 0.55, h: 0.01, d: 0.3, c: m.fire ? C.stamp : C.ok });
    }
  }
  return out;
}
