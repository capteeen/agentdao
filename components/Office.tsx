"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { agentsArray, topEarnerId, useBoss, votesArray } from "@/lib/store";
import type { Agent } from "@/lib/types";
import { computeLayout, dynamicBoxes, REPORT_DROP_MS, staticBoxes, workerState, type Box, type Layout, type Memo, type ReportDrop } from "@/lib/office/scene";
import { createRenderer, IsoOffice, type OfficeRenderer } from "@/lib/office/renderers";
import { LABEL, RISK_COLOR, ruleValueLabel } from "@/lib/rules";

import Face from "./Face";

const STATE_LABEL: Record<string, string> = {
  typing: "typing (trading)",
  phone: "on the phone (launching)",
  asleep: "asleep (no orders yet)",
  sweating: "sweating (losing streak)",
  corner: "corner office (top earner)",
  fired: "carrying a box out",
};

const FOCUS_MS = 4200; // how long the camera follows a memo
const isMobile = () => typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 640);

export default function Office({ height = "60vh", filter, interactive = true, zoom, follow = true }: { height?: string; filter?: (a: Agent) => boolean; interactive?: boolean; zoom?: number; follow?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const [hoverAgent, setHoverAgent] = useState<Agent | null>(null);
  const [hoverState, setHoverState] = useState("");

  useEffect(() => {
    const el = wrap.current!;
    const cv = canvas.current!;
    const ov = overlay.current!;
    const mobile = isMobile();
    const baseZoom = zoom ?? (mobile ? 1.7 : 1.3);
    const force2d = new URLSearchParams(location.search).has("2d");
    let r: OfficeRenderer = createRenderer(cv, force2d);
    r.setZoom(baseZoom);
    el.dataset.renderer = r.kind;
    el.dataset.zoom = String(baseZoom);

    let layout: Layout | null = null;
    let layoutKey = "";
    let hover: string | null = null;
    let raf = 0;
    let visible = true;
    let yaw = 0;
    let userZoom = 1; // pinch / wheel
    const t0 = performance.now();
    const frameMs = mobile ? 1000 / 30 : 0; // 30fps on phones
    let lastFrame = 0;

    // smoothed camera
    const cam = { cx: 0, cz: 0, mul: 1 };
    let focusKey = "";
    let reportDrop: ReportDrop | null = null;
    let lastBell = useBoss.getState().bell;

    const resize = () => {
      const b = el.getBoundingClientRect();
      r.resize(b.width, b.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);

    // overlay element pool (stamps, signs, captions)
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

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      if (frameMs && ts - lastFrame < frameMs) return;
      lastFrame = ts;
      const s = useBoss.getState();
      if (!s.ready) return;
      const now = Date.now();
      const t = (performance.now() - t0) / 1000;
      const agents = onFloor(agentsArray(s.agents));
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
      const liveVotes = votesArray(s.votes).filter((v) => v.status === "live");
      const memos: Memo[] = [];
      for (const e of s.events) {
        if (now - e.at > 4000) break;
        if ((e.kind === "vote_pass" || (e.kind === "fired" && e.voteId)) && e.voteId) memos.push({ voteId: e.voteId, agentId: e.agentId, at: e.at, fire: e.kind === "fired" });
      }
      // bell rang: drop report cards
      if (s.bell !== lastBell) {
        lastBell = s.bell;
        const grades: Record<string, string> = {};
        for (const rep of s.reports) {
          if (now - rep.at > 10_000) break;
          grades[rep.agentId] ??= rep.grade;
        }
        reportDrop = { at: now, grades };
      }
      if (reportDrop && now - reportDrop.at > REPORT_DROP_MS) reportDrop = null;

      // Camera: follow the memo for a few seconds, then ease back.
      const f = follow && s.focus && now - s.focus.at < FOCUS_MS && layout.slots.has(s.focus.agentId) ? s.focus : null;
      const target = f ? { ...layout.slots.get(f.agentId)!, mul: mobile ? 1.6 : 1.9 } : { x: 0, z: 0, mul: 1 };
      const k = 0.08;
      cam.cx += (target.x - cam.cx) * k;
      cam.cz += (target.z - cam.cz) * k;
      cam.mul += (target.mul - cam.mul) * k;
      r.setView(cam.cx, cam.cz, cam.mul * userZoom);
      const fk = f ? f.agentId + f.at : "";
      if (fk !== focusKey) focusKey = fk;

      const boxes: Box[] = dynamicBoxes(layout, { agents, liveVotes, memos, topId, now, t, hoverId: hover, reportDrop });
      r.frame(boxes);

      // DOM overlays
      let n = 0;
      for (const m of memos) {
        const age = now - m.at;
        const slot = layout.slots.get(m.agentId);
        if (!slot || age < 1700 || age > 3800) continue;
        const p = r.project(slot.x, 2.2, slot.z);
        const d = getEl(n++);
        const cls = `ov-stamp stamp-mark ${m.fire ? "" : "ok"} bg-[#f5e663]/90`;
        if (d.className !== cls) d.className = cls;
        d.style.left = p.x + "px";
        d.style.top = p.y + "px";
        d.style.display = "block";
        d.textContent = m.fire ? "FIRED" : "APPROVED";
      }
      if (f) {
        // caption under the focused desk
        const slot = layout.slots.get(f.agentId)!;
        const p = r.project(slot.x, -0.4, slot.z + 1.2);
        const d = getEl(n++);
        d.className = "ov-cap memo-card px-3 py-1 text-base sm:text-lg";
        d.style.left = p.x + "px";
        d.style.top = p.y + "px";
        d.style.display = "block";
        d.textContent = f.label;
      }
      if (reportDrop) {
        for (const a of agents) {
          const g = reportDrop.grades[a.id];
          const slot = layout.slots.get(a.id);
          if (!g || !slot) continue;
          const age = now - reportDrop.at - (a.seed % 7) * 120;
          if (age < 900) continue;
          const p = r.project(slot.x, 1.2, slot.z);
          const d = getEl(n++);
          d.className = `ov-tip h-pixel text-[10px] px-1 ${g.startsWith("A") ? "text-[#2e8c46]" : g === "F" ? "text-stamp" : "text-[#1b1815]"}`;
          d.style.left = p.x + "px";
          d.style.top = p.y + "px";
          d.style.display = "block";
          d.textContent = g;
        }
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
      // hover: ticker label above the desk + React magnifier card
      if (hover) {
        const a = agents.find((x) => x.id === hover);
        const slot = layout.slots.get(hover);
        if (a && slot) {
          const p = r.project(slot.x, 2.6, slot.z);
          const d = getEl(n++);
          d.className = "ov-tip h-pixel text-[9px] px-2 py-1 bg-memo text-[#1b1815]";
          d.style.left = p.x + "px";
          d.style.top = p.y + "px";
          d.style.display = "block";
          d.textContent = `$${a.ticker}`;
          if (tip.current) {
            const b = el.getBoundingClientRect();
            const left = Math.min(Math.max(8, p.x + 20), b.width - 240);
            const top = Math.min(Math.max(8, p.y - 60), b.height - 170);
            tip.current.style.transform = `translate(${left}px, ${top}px)`;
          }
          const st = STATE_LABEL[workerState(a, now, topId)] ?? "";
          setHoverState((x) => (x === st ? x : st));
        }
      }
      for (let i = n; i < pool.length; i++) pool[i].style.display = "none";
    };
    raf = requestAnimationFrame(loop);

    // ---- input: pick, drag to rotate, pinch / wheel to zoom
    const pointers = new Map<number, { x: number; y: number }>();
    let down: { x: number; yaw: number } | null = null;
    let dragged = false;
    let pinchStart = 0;
    let pinchZoom = 1;
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
    const setHover = (id: string | null) => {
      if (id === hover) return;
      hover = id;
      const a = id ? useBoss.getState().agents[id] : null;
      setHoverAgent(a ?? null);
    };
    const dist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const onMove = (e: PointerEvent) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinchStart) {
        userZoom = Math.max(0.6, Math.min(3, pinchZoom * (dist() / pinchStart)));
        dragged = true;
        return;
      }
      if (down && r.kind === "3d") {
        const dx = e.clientX - down.x;
        if (Math.abs(dx) > 6) dragged = true;
        if (dragged) {
          yaw = Math.max(-0.7, Math.min(0.7, down.yaw - dx / 300));
          r.setYaw(yaw);
        }
        return;
      }
      if (!interactive || e.pointerType === "touch") return;
      const id = pickAt(e.clientX, e.clientY);
      setHover(id);
      el.style.cursor = id ? "pointer" : r.kind === "3d" ? "grab" : "default";
    };
    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        pinchStart = dist();
        pinchZoom = userZoom;
        down = null;
        return;
      }
      down = { x: e.clientX, yaw };
      dragged = false;
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = 0;
      const wasDrag = dragged;
      down = null;
      dragged = false;
      if (wasDrag || !interactive || pointers.size) return;
      const id = pickAt(e.clientX, e.clientY);
      if (!id) return;
      // on touch, first tap shows the card, second tap opens the agent
      if (e.pointerType === "touch" && hover !== id) return setHover(id);
      router.push(`/agent/${id}`);
    };
    const onLeave = () => {
      setHover(null);
      down = null;
      pointers.clear();
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 1) return;
      if (!e.ctrlKey && !e.metaKey) return; // plain scroll keeps scrolling the page
      e.preventDefault();
      userZoom = Math.max(0.6, Math.min(3, userZoom * (e.deltaY > 0 ? 0.92 : 1.08)));
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("wheel", onWheel, { passive: false });

    // WebGL context loss -> fall back to 2D
    const onLost = (e: Event) => {
      e.preventDefault();
      r.dispose();
      const fresh = cv.cloneNode() as HTMLCanvasElement;
      cv.replaceWith(fresh);
      r = new IsoOffice(fresh);
      r.setZoom(baseZoom);
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
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("wheel", onWheel);
      cv.removeEventListener("webglcontextlost", onLost);
      r.dispose();
      ov.innerHTML = "";
    };
  }, [router, interactive, zoom, follow]);

  return (
    <div ref={wrap} className="relative w-full touch-none select-none overflow-hidden" style={{ height }}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      <div ref={overlay} className="pointer-events-none absolute inset-0" />
      {hoverAgent && (
        <div ref={tip} className="pointer-events-none absolute left-0 top-0 z-10 w-[230px] will-change-transform">
          <div className="px-box flex gap-2 p-2">
            <div className="shrink-0">
              <DeskSprite agent={hoverAgent} size={84} />
            </div>
            <div className="min-w-0 text-base leading-tight">
              <div className="h-pixel flex items-center gap-1 text-[9px]">
                <Face image={hoverAgent.image} /> ${hoverAgent.ticker}
              </div>
              <div className="truncate text-dim">{hoverAgent.name}</div>
              <div className="mt-1">
                {LABEL[hoverAgent.rules.strategy]} · <span style={{ color: RISK_COLOR[hoverAgent.rules.risk] }}>{LABEL[hoverAgent.rules.risk]}</span>
              </div>
              <div>
                TP {ruleValueLabel("takeProfit", hoverAgent.rules)} · {LABEL[hoverAgent.rules.cadence]}
              </div>
              <div>
                {hoverAgent.vault.toFixed(1)} SOL · <span className={hoverAgent.pnl7d >= 0 ? "text-ok" : "text-stamp"}>{(hoverAgent.pnl7d >= 0 ? "+" : "") + hoverAgent.pnl7d.toFixed(2)}</span>
              </div>
              <div className="text-dim">{hoverState}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small animated 2D desk sprite for a single agent (no WebGL context used). */
export function DeskSprite({ agent, size = 160 }: { agent: Agent; size?: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const id = agent.id;
  useEffect(() => {
    const c = cv.current!;
    const r = new IsoOffice(c, size < 100 ? 1.5 : 2);
    r.setZoom(size < 100 ? 2.4 : 1.7);
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
      const a = s.agents[id];
      if (!a) return;
      const top = topEarnerId(agentsArray(s.agents));
      const now = Date.now();
      // fired agents: show the cleared desk + box (frozen at start of walk)
      const shown = a.status === "fired" || a.status === "bankrupt" ? { ...a, firedAt: now - 600, liquidated: 0 } : a;
      r.frame(dynamicBoxes(layout, { agents: [shown], liveVotes: [], memos: [], topId: top, now, t: (performance.now() - t0) / 1000 }));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [id, size]);
  return <canvas ref={cv} width={size} height={size} style={{ width: size, height: size }} />;
}

