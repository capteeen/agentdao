"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { topEarnerId, useBoss } from "@/lib/store";
import type { Agent } from "@/lib/types";
import { computeLayout, dynamicBoxes, staticBoxes, workerState, type Layout, type Memo, type Box } from "@/lib/office/scene";
import { createRenderer, IsoOffice, type OfficeRenderer } from "@/lib/office/renderers";
import { LABEL } from "@/lib/rules";

const STATE_LABEL: Record<string, string> = {
  typing: "typing (trading)",
  phone: "on the phone (launching)",
  asleep: "asleep (no rule set)",
  sweating: "sweating (losing streak)",
  corner: "corner office (top earner)",
  fired: "carrying a box out",
};

export default function Office({ height = "60vh", filter, interactive = true, zoom = 1.3 }: { height?: string; filter?: (a: Agent) => boolean; interactive?: boolean; zoom?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const filterRef = useRef(filter);
  filterRef.current = filter;

  useEffect(() => {
    const el = wrap.current!;
    const cv = canvas.current!;
    const ov = overlay.current!;
    const force2d = typeof window !== "undefined" && new URLSearchParams(location.search).has("2d");
    let r: OfficeRenderer = createRenderer(cv, force2d);
    r.setZoom(zoom);
    el.dataset.renderer = r.kind;

    let layout: Layout | null = null;
    let layoutKey = "";
    let hover: string | null = null;
    let raf = 0;
    let visible = true;
    let yaw = 0;
    const t0 = performance.now();

    const resize = () => {
      const b = el.getBoundingClientRect();
      r.resize(b.width, b.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);

    // overlay element pool
    const pool: HTMLDivElement[] = [];
    const getEl = (i: number) => {
      if (!pool[i]) {
        const d = document.createElement("div");
        ov.appendChild(d);
        pool[i] = d;
      }
      return pool[i];
    };

    const onFloor = (agents: Agent[]) => (filterRef.current ? agents.filter(filterRef.current) : agents);

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      const s = useBoss.getState();
      if (!s.ready) return;
      const now = Date.now();
      const t = (performance.now() - t0) / 1000;
      const agents = onFloor(s.agents);
      const topId = topEarnerId(agents);
      const ids = agents
        .filter((a) => a.status === "working" || a.status === "idle" || (a.firedAt && now - a.firedAt < 9000))
        .map((a) => a.id)
        .join(",");
      const key = ids + "|" + topId;
      if (key !== layoutKey || !layout) {
        layoutKey = key;
        layout = computeLayout(agents, topId, now);
        r.setStatic(staticBoxes(layout), { w: layout.width, d: layout.depth });
      }
      const liveVotes = s.votes.filter((v) => v.status === "live");
      const memos: Memo[] = [];
      for (const e of s.events) {
        if (now - e.at > 4000) break;
        if ((e.kind === "vote_pass" || (e.kind === "fired" && e.voteId)) && e.voteId) memos.push({ voteId: e.voteId, agentId: e.agentId, at: e.at, fire: e.kind === "fired" });
      }
      const boxes: Box[] = dynamicBoxes(layout, { agents, liveVotes, memos, topId, now, t, hoverId: hover });
      r.frame(boxes);

      // DOM overlays: APPROVED / FIRED stamps + hover tooltip + boardroom sign
      let n = 0;
      for (const m of memos) {
        const age = now - m.at;
        const slot = layout.slots.get(m.agentId);
        if (!slot || age < 1700 || age > 3800) continue;
        const p = r.project(slot.x, 2.2, slot.z);
        const d = getEl(n++);
        const a = agents.find((x) => x.id === m.agentId);
        const cls = `ov-stamp stamp-mark ${m.fire ? "" : "ok"} bg-[#f5e663]/90`;
        if (d.className !== cls) d.className = cls;
        d.style.left = p.x + "px";
        d.style.top = p.y + "px";
        d.style.display = "block";
        d.textContent = m.fire ? "FIRED" : "APPROVED";
        d.title = a?.ticker ?? "";
      }
      if (liveVotes.length) {
        const p = r.project(layout.boardroom.x, 3.2, layout.boardroom.z);
        const d = getEl(n++);
        d.className = "ov-tip h-pixel text-[8px] px-2 py-1 bg-stamp text-white";
        d.style.left = p.x + "px";
        d.style.top = p.y + "px";
        d.style.display = "block";
        d.textContent = `● ${liveVotes.length} VOTE${liveVotes.length > 1 ? "S" : ""} LIVE`;
      }
      if (hover) {
        const a = agents.find((x) => x.id === hover);
        const slot = layout.slots.get(hover);
        if (a && slot) {
          const p = r.project(slot.x, 2.8, slot.z);
          const d = getEl(n++);
          d.className = "ov-tip px-box px-2 py-1 text-base leading-tight";
          d.style.left = p.x + "px";
          d.style.top = p.y + "px";
          d.style.display = "block";
          d.innerHTML = "";
          const l1 = document.createElement("div");
          l1.className = "h-pixel text-[9px]";
          l1.textContent = `${/^(data:|http)/.test(a.image) ? "" : a.image + " "}$${a.ticker}`;
          const l2 = document.createElement("div");
          l2.textContent = `${LABEL[a.rules.strategy]} · ${LABEL[a.rules.risk]} · ${a.vault.toFixed(1)} SOL`;
          const l3 = document.createElement("div");
          l3.className = "text-dim";
          l3.textContent = STATE_LABEL[workerState(a, now, topId)] ?? "";
          d.append(l1, l2, l3);
        }
      }
      for (let i = n; i < pool.length; i++) pool[i].style.display = "none";
    };
    raf = requestAnimationFrame(loop);

    // picking + drag-to-rotate
    let down: { x: number; yaw: number } | null = null;
    let dragged = false;
    const pickAt = (cx: number, cy: number) => {
      if (!layout) return null;
      const b = el.getBoundingClientRect();
      const px = cx - b.left,
        py = cy - b.top;
      let best: string | null = null,
        bd = 40 * 40;
      layout.slots.forEach((s, id) => {
        const p = r.project(s.x, 0.9, s.z);
        const d = (p.x - px) ** 2 + (p.y - py) ** 2;
        if (d < bd) {
          bd = d;
          best = id;
        }
      });
      return best;
    };
    const onMove = (e: PointerEvent) => {
      if (down && r.kind === "3d") {
        const dx = e.clientX - down.x;
        if (Math.abs(dx) > 6) dragged = true;
        if (dragged) {
          yaw = Math.max(-0.7, Math.min(0.7, down.yaw - dx / 300));
          r.setYaw(yaw);
        }
        return;
      }
      if (!interactive) return;
      hover = pickAt(e.clientX, e.clientY);
      el.style.cursor = hover ? "pointer" : r.kind === "3d" ? "grab" : "default";
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, yaw };
      dragged = false;
    };
    const onUp = (e: PointerEvent) => {
      const wasDrag = dragged;
      down = null;
      dragged = false;
      if (wasDrag || !interactive) return;
      const id = pickAt(e.clientX, e.clientY);
      if (id) router.push(`/agent/${id}`);
    };
    const onLeave = () => {
      hover = null;
      down = null;
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", onLeave);

    // WebGL context loss -> fall back to 2D
    const onLost = (e: Event) => {
      e.preventDefault();
      r.dispose();
      const fresh = cv.cloneNode() as HTMLCanvasElement;
      cv.replaceWith(fresh);
      r = new IsoOffice(fresh);
      r.setZoom(zoom);
      el.dataset.renderer = "2d";
      layoutKey = "";
      resize();
    };
    cv.addEventListener("webglcontextlost", onLost);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
      cv.removeEventListener("webglcontextlost", onLost);
      r.dispose();
      ov.innerHTML = "";
    };
  }, [router, interactive, zoom]);

  return (
    <div ref={wrap} className="relative w-full touch-pan-y select-none overflow-hidden" style={{ height }}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      <div ref={overlay} className="pointer-events-none absolute inset-0" />
    </div>
  );
}

/** Small animated 2D desk sprite for a single agent (no WebGL context used). */
export function DeskSprite({ agent, size = 160 }: { agent: Agent; size?: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const id = agent.id;
  useEffect(() => {
    const c = cv.current!;
    const r = new IsoOffice(c, 2);
    r.setZoom(1.7);
    r.resize(size, size);
    const layout: Layout = {
      slots: new Map([[id, { x: 0, z: 0, corner: false }]]),
      width: 4,
      depth: 4,
      boardroom: { x: -30, z: -30 },
      door: { x: 6, z: -2 },
      corner: { x: 99, z: 99 },
    };
    const floor: Box[] = [];
    for (let x = -2; x < 2; x += 1) for (let z = -2; z < 2; z += 1) floor.push({ x: x + 0.5, y: -0.2, z: z + 0.5, w: 1, h: 0.2, d: 1, c: (x + z) & 1 ? 0x2a2520 : 0x312b25 });
    r.setStatic(floor, { w: 4, d: 4 });
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = useBoss.getState();
      const a = s.agents.find((x) => x.id === id);
      if (!a) return;
      const top = topEarnerId(s.agents);
      const now = Date.now();
      // fired agents: show the cleared desk + box (frozen at start of walk)
      const shown = a.status === "fired" || a.status === "bankrupt" ? { ...a, firedAt: now - 600 } : a;
      r.frame(dynamicBoxes(layout, { agents: [shown], liveVotes: [], memos: [], topId: top, now, t: (performance.now() - t0) / 1000 }));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [id, size]);
  return <canvas ref={cv} width={size} height={size} style={{ width: size, height: size }} />;
}
