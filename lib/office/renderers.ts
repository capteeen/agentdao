// Two renderers for the same Box list:
//  - ThreeOffice: Three.js orthographic, instanced voxel cubes, flat Lambert,
//    rendered at low resolution and upscaled with image-rendering: pixelated.
//  - IsoOffice:   2D canvas isometric fallback (no WebGL).

import * as THREE from "three";
import type { Box } from "./scene";

export interface OfficeRenderer {
  setStatic(boxes: Box[], bounds: { w: number; d: number }): void;
  frame(boxes: Box[]): void;
  resize(w: number, h: number): void;
  project(x: number, y: number, z: number): { x: number; y: number };
  setYaw(yaw: number): void;
  /** >1 crops into the floor (the corners of the diamond are mostly empty). */
  setZoom(z: number): void;
  /** Camera target: a world point and an extra zoom multiplier (1 = full floor). */
  setView(cx: number, cz: number, mul: number): void;
  /** Night (default) vs day lighting. */
  setNight(night: boolean): void;
  dispose(): void;
  kind: "3d" | "2d";
}

const PIXEL = 3; // CSS px per rendered pixel (chunky); scaled by canvas width, see pixelFor()
/** Bigger canvases get finer pixels; a phone stays at 1 so desks remain legible. */
export const pixelFor = (w: number) => Math.max(1, Math.min(3, Math.round(w / 460)));
const OUTLINE = 0.05; // inverted-hull outline thickness (world units)
const thin = (b: Box) => b.w < 0.12 || b.h < 0.12 || b.d < 0.12;

// -------------------------------------------------------------- Three.js

const colorCache = new Map<number, THREE.Color>();
const col = (hex: number) => {
  let c = colorCache.get(hex);
  if (!c) colorCache.set(hex, (c = new THREE.Color(hex)));
  return c;
};

class BoxBatch {
  mesh: THREE.InstancedMesh;
  cap: number;
  constructor(
    private scene: THREE.Scene,
    private mat: THREE.Material,
    private geo: THREE.BufferGeometry,
    cap: number,
  ) {
    this.cap = cap;
    this.mesh = this.make(cap);
  }
  private make(cap: number) {
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    this.scene.add(m);
    return m;
  }
  write(boxes: Box[], inflate = 0) {
    if (boxes.length > this.cap) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      this.cap = Math.ceil(boxes.length * 1.5);
      this.mesh = this.make(this.cap);
    }
    const M = this.mesh.instanceMatrix.array as Float32Array;
    const Cc = this.mesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const o = i * 16;
      M[o] = b.w + inflate;
      M[o + 1] = 0;
      M[o + 2] = 0;
      M[o + 3] = 0;
      M[o + 4] = 0;
      M[o + 5] = b.h + inflate;
      M[o + 6] = 0;
      M[o + 7] = 0;
      M[o + 8] = 0;
      M[o + 9] = 0;
      M[o + 10] = b.d + inflate;
      M[o + 11] = 0;
      M[o + 12] = b.x;
      M[o + 13] = b.y - inflate / 2;
      M[o + 14] = b.z;
      M[o + 15] = 1;
      const c = col(b.c);
      Cc[i * 3] = c.r;
      Cc[i * 3 + 1] = c.g;
      Cc[i * 3 + 2] = c.b;
    }
    this.mesh.count = boxes.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
  }
}

export class ThreeOffice implements OfficeRenderer {
  kind = "3d" as const;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500);
  geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  solid: THREE.MeshLambertMaterial;
  glassMat: THREE.MeshLambertMaterial;
  glowMat: THREE.MeshBasicMaterial;
  shadowMat: THREE.MeshBasicMaterial;
  outlineMat: THREE.MeshBasicMaterial;
  stat: BoxBatch;
  statGlass: BoxBatch;
  statGlow: BoxBatch;
  statOutline: BoxBatch;
  dyn: BoxBatch;
  dynGlass: BoxBatch;
  dynGlow: BoxBatch;
  dynShadow: BoxBatch;
  dynOutline: BoxBatch;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  bounds = { w: 20, d: 20 };
  pixel = PIXEL;
  yaw = 0;
  w = 1;
  h = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "low-power" });
    this.renderer.setClearColor(0x000000, 0);
    this.solid = new THREE.MeshLambertMaterial({ flatShading: true });
    this.glassMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.32, depthWrite: false });
    this.glowMat = new THREE.MeshBasicMaterial(); // unlit: screens, lamps, neon
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
    // Inverted-hull toon outline: inflated boxes, back faces only, drawn dark.
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0x100e0b, side: THREE.BackSide });
    this.hemi = new THREE.HemisphereLight(0xfff4e0, 0x2a2018, 1.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.9);
    this.sun.position.set(6, 14, 9);
    this.scene.add(this.sun);
    this.statOutline = new BoxBatch(this.scene, this.outlineMat, this.geo, 512);
    this.stat = new BoxBatch(this.scene, this.solid, this.geo, 512);
    this.statGlow = new BoxBatch(this.scene, this.glowMat, this.geo, 64);
    this.statGlass = new BoxBatch(this.scene, this.glassMat, this.geo, 32);
    this.dynOutline = new BoxBatch(this.scene, this.outlineMat, this.geo, 2048);
    this.dyn = new BoxBatch(this.scene, this.solid, this.geo, 2048);
    this.dynGlow = new BoxBatch(this.scene, this.glowMat, this.geo, 256);
    this.dynShadow = new BoxBatch(this.scene, this.shadowMat, this.geo, 256);
    this.dynGlass = new BoxBatch(this.scene, this.glassMat, this.geo, 32);
    this.dynShadow.mesh.renderOrder = 1;
    this.dynGlass.mesh.renderOrder = 2;
    this.statGlass.mesh.renderOrder = 2;
  }

  setNight(night: boolean) {
    if (night) {
      this.hemi.color.set(0xd9d2ff);
      this.hemi.groundColor.set(0x1a1410);
      this.hemi.intensity = 1.15;
      this.sun.color.set(0xffe9b8);
      this.sun.intensity = 1.5;
      this.renderer.setClearColor(0x000000, 0);
    } else {
      this.hemi.color.set(0xfff8ea);
      this.hemi.groundColor.set(0x6b5a48);
      this.hemi.intensity = 1.9;
      this.sun.color.set(0xffffff);
      this.sun.intensity = 2.1;
    }
  }

  setStatic(boxes: Box[], bounds: { w: number; d: number }) {
    const solid = boxes.filter((b) => !b.glass && !b.glow && !b.shadow);
    this.stat.write(solid);
    this.statOutline.write(solid.filter((b) => !b.noOutline && !thin(b)), OUTLINE);
    this.statGlow.write(boxes.filter((b) => b.glow));
    this.statGlass.write(boxes.filter((b) => b.glass));
    this.bounds = bounds;
    this.fit();
  }

  frame(boxes: Box[]) {
    const solid = boxes.filter((b) => !b.glass && !b.glow && !b.shadow);
    this.dyn.write(solid);
    this.dynOutline.write(solid.filter((b) => !b.noOutline && !thin(b)), OUTLINE);
    this.dynGlow.write(boxes.filter((b) => b.glow));
    this.dynShadow.write(boxes.filter((b) => b.shadow));
    this.dynGlass.write(boxes.filter((b) => b.glass));
    this.renderer.render(this.scene, this.camera);
  }

  setYaw(yaw: number) {
    this.yaw = yaw;
    this.fit();
  }

  zoom = 1;
  setZoom(z: number) {
    this.zoom = z;
    this.fit();
  }
  view = { cx: 0, cz: 0, mul: 1 };
  setView(cx: number, cz: number, mul: number) {
    this.view = { cx, cz, mul };
    this.fit();
  }

  resize(w: number, h: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.pixel = pixelFor(this.w);
    this.renderer.setPixelRatio(1 / this.pixel);
    this.renderer.setSize(this.w, this.h, true);
    this.fit();
  }

  private fit() {
    const a = Math.PI / 4 + this.yaw;
    const dist = 100;
    const el = Math.atan(1 / Math.SQRT2); // true isometric elevation
    this.camera.position.set(Math.sin(a) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(a) * Math.cos(el) * dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    // Fit the floor bbox in view space.
    const inv = this.camera.matrixWorldInverse;
    const { w, d } = this.bounds;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const [x, y, z] of [
      [-w / 2, 0, -d / 2],
      [w / 2, 0, -d / 2],
      [-w / 2, 0, d / 2],
      [w / 2, 0, d / 2],
      [-w / 2, 3.5, -d / 2],
      [w / 2, 3.5, -d / 2],
      [-w / 2, 3.5, d / 2],
    ]) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(inv);
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    let cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2;
    let hw = (maxX - minX) / 2 + 0.6,
      hh = (maxY - minY) / 2 + 0.6;
    const aspect = this.w / this.h;
    if (hw / hh > aspect) hh = hw / aspect;
    else hw = hh * aspect;
    const z = (aspect < 1.1 ? Math.min(this.zoom, 1.45) : this.zoom) * this.view.mul; // portrait: a tighter crop, pinch for more
    hw /= z;
    hh /= z;
    if (this.view.mul !== 1) {
      // blend the camera centre towards the focus point as we zoom in
      const f = new THREE.Vector3(this.view.cx, 0.8, this.view.cz).applyMatrix4(inv);
      const k = Math.min(1, (this.view.mul - 1) / 0.6);
      cx = cx + (f.x - cx) * k;
      cy = cy + (f.y - cy) * k;
    }
    Object.assign(this.camera, { left: cx - hw, right: cx + hw, top: cy + hh, bottom: cy - hh });
    this.camera.updateProjectionMatrix();
  }

  project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h };
  }

  dispose() {
    [this.stat, this.statGlass, this.statGlow, this.statOutline, this.dyn, this.dynGlass, this.dynGlow, this.dynShadow, this.dynOutline].forEach((b) => b.dispose());
    this.geo.dispose();
    this.solid.dispose();
    this.glassMat.dispose();
    this.glowMat.dispose();
    this.shadowMat.dispose();
    this.outlineMat.dispose();
    this.renderer.dispose();
  }
}

// -------------------------------------------------------------- 2D iso fallback

function shade(hex: number, f: number) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return `rgb(${r},${g},${b})`;
}

export class IsoOffice implements OfficeRenderer {
  kind = "2d" as const;
  ctx: CanvasRenderingContext2D;
  statics: Box[] = [];
  bounds = { w: 20, d: 20 };
  s = 10;
  ox = 0;
  oy = 0;
  w = 1;
  h = 1;
  lw = 1; // low-res buffer size
  lh = 1;
  yaw = 0;

  night = true;
  constructor(
    private canvas: HTMLCanvasElement,
    private pixel?: number,
  ) {
    this.ctx = canvas.getContext("2d")!;
  }
  setYaw() {}
  setNight(n: boolean) {
    this.night = n;
  }
  zoom = 1;
  setZoom(z: number) {
    this.zoom = z;
    this.fit();
  }
  view = { cx: 0, cz: 0, mul: 1 };
  setView(cx: number, cz: number, mul: number) {
    this.view = { cx, cz, mul };
    this.fit();
  }
  setStatic(boxes: Box[], bounds: { w: number; d: number }) {
    this.statics = boxes;
    this.bounds = bounds;
    this.fit();
  }
  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    const px = this.pixel ?? pixelFor(w);
    this.lw = Math.max(1, Math.round(w / px));
    this.lh = Math.max(1, Math.round(h / px));
    this.canvas.width = this.lw;
    this.canvas.height = this.lh;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.fit();
  }
  private fit() {
    const { w, d } = this.bounds;
    const isoW = (w + d) * 0.866;
    const isoH = (w + d) * 0.5 + 4;
    const aspect = this.lw / this.lh;
    this.s = Math.min(this.lw / (isoW + 1), this.lh / (isoH + 1)) * (aspect < 1.1 ? Math.min(this.zoom, 1.45) : this.zoom) * this.view.mul;
    this.ox = this.lw / 2;
    this.oy = this.lh / 2 + 1.5 * this.s;
    if (this.view.mul !== 1) {
      const k = Math.min(1, (this.view.mul - 1) / 0.6);
      const [fx, fy] = this.p(this.view.cx, 0.8, this.view.cz);
      this.ox -= (fx - this.lw / 2) * k;
      this.oy -= (fy - this.lh / 2) * k;
    }
  }
  private p(x: number, y: number, z: number): [number, number] {
    return [this.ox + (x - z) * 0.866 * this.s, this.oy + (x + z) * 0.5 * this.s - y * this.s];
  }
  project(x: number, y: number, z: number) {
    const [a, b] = this.p(x, y, z);
    return { x: a * (this.w / this.lw), y: b * (this.h / this.lh) };
  }
  frame(dyn: Box[]) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.lw, this.lh);
    const all = this.statics.concat(dyn);
    // flat floor-level boxes first, then painter's order by depth
    const flat = (b: Box) => b.y + b.h <= 0.05;
    all.sort((a, b) => Number(!flat(a)) - Number(!flat(b)) || a.x + a.w / 2 + a.z + a.d / 2 - (b.x + b.w / 2 + b.z + b.d / 2) || a.y - b.y);
    for (const b of all) {
      const x0 = b.x - b.w / 2,
        x1 = b.x + b.w / 2,
        z0 = b.z - b.d / 2,
        z1 = b.z + b.d / 2,
        y0 = b.y,
        y1 = b.y + b.h;
      if (b.shadow) {
        ctx.globalAlpha = 0.32;
        this.poly([this.p(x0, y0, z0), this.p(x1, y0, z0), this.p(x1, y0, z1), this.p(x0, y0, z1)], "#000");
        continue;
      }
      ctx.globalAlpha = b.glass ? 0.3 : 1;
      const lit = b.glow ? 1 : this.night ? 1 : 1.08;
      const stroke = !b.noOutline && !thin(b);
      // top
      this.poly([this.p(x0, y1, z0), this.p(x1, y1, z0), this.p(x1, y1, z1), this.p(x0, y1, z1)], shade(b.c, b.glow ? 1 : 1.1 * lit), stroke);
      // +z face (left on screen)
      this.poly([this.p(x0, y0, z1), this.p(x1, y0, z1), this.p(x1, y1, z1), this.p(x0, y1, z1)], shade(b.c, b.glow ? 0.95 : 0.8 * lit), stroke);
      // +x face (right on screen)
      this.poly([this.p(x1, y0, z0), this.p(x1, y0, z1), this.p(x1, y1, z1), this.p(x1, y1, z0)], shade(b.c, b.glow ? 0.9 : 0.62 * lit), stroke);
    }
    ctx.globalAlpha = 1;
  }
  private poly(pts: [number, number][], fill: string, stroke = false) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = "#100e0b";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  dispose() {}
}

export function createRenderer(canvas: HTMLCanvasElement, force2d = false): OfficeRenderer {
  if (!force2d) {
    try {
      return new ThreeOffice(canvas);
    } catch {
      /* fall through to 2D */
    }
  }
  return new IsoOffice(canvas);
}
