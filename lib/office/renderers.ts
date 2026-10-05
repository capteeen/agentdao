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
  dispose(): void;
  kind: "3d" | "2d";
}

const PIXEL = 3; // CSS px per rendered pixel (chunky)

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
  write(boxes: Box[]) {
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
      M[o] = b.w;
      M[o + 1] = 0;
      M[o + 2] = 0;
      M[o + 3] = 0;
      M[o + 4] = 0;
      M[o + 5] = b.h;
      M[o + 6] = 0;
      M[o + 7] = 0;
      M[o + 8] = 0;
      M[o + 9] = 0;
      M[o + 10] = b.d;
      M[o + 11] = 0;
      M[o + 12] = b.x;
      M[o + 13] = b.y;
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
  stat: BoxBatch;
  statGlass: BoxBatch;
  dyn: BoxBatch;
  dynGlass: BoxBatch;
  bounds = { w: 20, d: 20 };
  yaw = 0;
  w = 1;
  h = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "low-power" });
    this.renderer.setClearColor(0x000000, 0);
    this.solid = new THREE.MeshLambertMaterial({ vertexColors: false, flatShading: true });
    this.glassMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.32, depthWrite: false });
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2018, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(6, 14, 9);
    this.scene.add(sun);
    this.stat = new BoxBatch(this.scene, this.solid, this.geo, 512);
    this.statGlass = new BoxBatch(this.scene, this.glassMat, this.geo, 32);
    this.dyn = new BoxBatch(this.scene, this.solid, this.geo, 2048);
    this.dynGlass = new BoxBatch(this.scene, this.glassMat, this.geo, 32);
  }

  setStatic(boxes: Box[], bounds: { w: number; d: number }) {
    this.stat.write(boxes.filter((b) => !b.glass));
    this.statGlass.write(boxes.filter((b) => b.glass));
    this.bounds = bounds;
    this.fit();
  }

  frame(boxes: Box[]) {
    this.dyn.write(boxes.filter((b) => !b.glass));
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

  resize(w: number, h: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.renderer.setPixelRatio(1 / PIXEL);
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
    const cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2;
    let hw = (maxX - minX) / 2 + 0.6,
      hh = (maxY - minY) / 2 + 0.6;
    const aspect = this.w / this.h;
    if (hw / hh > aspect) hh = hw / aspect;
    else hw = hh * aspect;
    const z = aspect < 1.1 ? 1 : this.zoom; // portrait: show the whole floor
    hw /= z;
    hh /= z;
    Object.assign(this.camera, { left: cx - hw, right: cx + hw, top: cy + hh, bottom: cy - hh });
    this.camera.updateProjectionMatrix();
  }

  project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h };
  }

  dispose() {
    [this.stat, this.statGlass, this.dyn, this.dynGlass].forEach((b) => b.dispose());
    this.geo.dispose();
    this.solid.dispose();
    this.glassMat.dispose();
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

  constructor(
    private canvas: HTMLCanvasElement,
    private pixel = PIXEL,
  ) {
    this.ctx = canvas.getContext("2d")!;
  }
  setYaw() {}
  zoom = 1;
  setZoom(z: number) {
    this.zoom = z;
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
    this.lw = Math.max(1, Math.round(w / this.pixel));
    this.lh = Math.max(1, Math.round(h / this.pixel));
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
    this.s = Math.min(this.lw / (isoW + 1), this.lh / (isoH + 1)) * this.zoom;
    this.ox = this.lw / 2;
    this.oy = this.lh / 2 + 1.5 * this.s;
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
      ctx.globalAlpha = b.glass ? 0.3 : 1;
      // top
      this.poly([this.p(x0, y1, z0), this.p(x1, y1, z0), this.p(x1, y1, z1), this.p(x0, y1, z1)], shade(b.c, 1.1));
      // +z face (left on screen)
      this.poly([this.p(x0, y0, z1), this.p(x1, y0, z1), this.p(x1, y1, z1), this.p(x0, y1, z1)], shade(b.c, 0.8));
      // +x face (right on screen)
      this.poly([this.p(x1, y0, z0), this.p(x1, y0, z1), this.p(x1, y1, z1), this.p(x1, y1, z0)], shade(b.c, 0.62));
    }
    ctx.globalAlpha = 1;
  }
  private poly(pts: [number, number][], fill: string) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
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
