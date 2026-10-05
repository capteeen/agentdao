"use client";

// Tiny WebAudio 8-bit synth. No assets. Off by default.

let ctx: AudioContext | null = null;
function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function beep(freq: number, dur: number, type: OscillatorType = "square", vol = 0.05, at = 0, slide?: number) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol = 0.08, at = 0) {
  const c = ac();
  if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = c.createBufferSource();
  const g = c.createGain();
  g.gain.value = vol;
  s.buffer = buf;
  s.connect(g).connect(c.destination);
  s.start(c.currentTime + at);
}

export const sfx = {
  key() {
    for (let i = 0; i < 3; i++) beep(1800 + Math.random() * 600, 0.02, "square", 0.015, i * 0.06);
  },
  stamp() {
    noise(0.12, 0.25);
    beep(110, 0.15, "square", 0.08, 0, 55);
  },
  phone() {
    for (let i = 0; i < 4; i++) {
      beep(1320, 0.05, "square", 0.03, i * 0.1);
      beep(1100, 0.05, "square", 0.03, i * 0.1 + 0.05);
    }
  },
  box() {
    beep(180, 0.2, "triangle", 0.1, 0, 60);
    noise(0.08, 0.2, 0.05);
  },
  bell() {
    beep(1568, 0.4, "square", 0.04);
    beep(2093, 0.5, "square", 0.03, 0.12);
  },
  click() {
    beep(880, 0.04, "square", 0.03);
  },
};
