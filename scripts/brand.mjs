const { createRequire } = await import("node:module");
const require = createRequire("/home/user/agentdao/package.json");
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
import fs from "node:fs";
// reuse the sprite from the repo (compiled on the fly via tsx)
const { spritePixels } = await import("tsx/esm/api").then(m => m.tsImport("/home/user/agentdao/lib/sprite.ts", import.meta.url));

const px = (kind, seed, P, x0, y0) => spritePixels(kind, seed).map(p => `<rect x="${x0 + p.x * P}" y="${y0 + p.y * P}" width="${P}" height="${P}" fill="${p.c}"/>`).join("");
const FONT = `@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap');`;

// ---- icon 400x400: yellow memo tile, worker sprite, small stamp
const icon = `<!doctype html><html><head><style>${FONT} body{margin:0;background:#000}</style></head><body>
<svg id="icon" xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" shape-rendering="crispEdges">
  <rect width="400" height="400" fill="#1b1815"/>
  <rect x="24" y="24" width="352" height="352" fill="#f5e663"/>
  <rect x="24" y="24" width="352" height="12" fill="#1b1815" opacity=".15"/>
  <rect x="40" y="40" width="320" height="320" fill="#2a2520"/>
  ${px("working", 1, 20, 40, 40)}
  <g transform="rotate(-12 270 300)">
    <rect x="196" y="278" width="148" height="44" fill="#f5e663" opacity=".85"/>
    <rect x="196" y="278" width="148" height="44" fill="none" stroke="#2e8c46" stroke-width="6"/>
    <text x="270" y="308" font-family="'Press Start 2P',monospace" font-size="13" fill="#2e8c46" text-anchor="middle">APPROVED</text>
  </g>
</svg></body></html>`;

// ---- banner 1500x500: office floor, neon BOSS, tagline, worker row, memo + stamp, fired guy with box
const desks = [0, 1, 2, 3, 4, 5].map(i => {
  const x = (i < 3 ? 950 : 1000) + (i % 3) * 110, y = i < 3 ? 110 : 270;
  const kind = i === 5 ? "fired" : "working";
  return `<rect x="${x - 6}" y="${y + 108}" width="124" height="12" fill="#000" opacity=".35"/>${px(kind, i * 7 + 3, 7, x, y)}`;
}).join("");
const tiles = [];
for (let x = 0; x < 1500; x += 50) for (let y = 0; y < 500; y += 50) tiles.push(`<rect x="${x}" y="${y}" width="50" height="50" fill="${((x / 50 + y / 50) % 2) ? "#2a2520" : "#241f1b"}"/>`);
const banner = `<!doctype html><html><head><style>${FONT} body{margin:0;background:#000}</style></head><body>
<svg id="banner" xmlns="http://www.w3.org/2000/svg" width="1500" height="500" viewBox="0 0 1500 500" shape-rendering="crispEdges">
  <rect width="1500" height="500" fill="#1b1815"/>
  ${tiles.join("")}
  <rect x="0" y="0" width="1500" height="500" fill="url(#v)"/>
  <defs><radialGradient id="v" cx="50%" cy="50%" r="70%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".55"/></radialGradient></defs>
  <!-- ceiling lamps -->
  ${[300, 700, 1100].map(x => `<rect x="${x - 3}" y="0" width="6" height="40" fill="#3a3a3a"/><rect x="${x - 40}" y="40" width="80" height="18" fill="#f6f0d8"/><rect x="${x - 24}" y="58" width="48" height="8" fill="#fff2b0"/>`).join("")}
  <!-- neon BOSS -->
  <text x="90" y="200" font-family="'Press Start 2P',monospace" font-size="96" fill="#f5e663" style="paint-order:stroke" stroke="#000" stroke-width="12">BOSS</text>
  <text x="92" y="262" font-family="'Press Start 2P',monospace" font-size="22" fill="#f4f4f2" stroke="#000" stroke-width="6" style="paint-order:stroke">THE AGENT IS YOUR EMPLOYEE</text>
  <text x="94" y="318" font-family="VT323,monospace" font-size="40" fill="#f4f4f2" stroke="#000" stroke-width="5" style="paint-order:stroke">Holders vote. It obeys within one block.</text>
  <text x="94" y="366" font-family="VT323,monospace" font-size="34" fill="#7bd389" stroke="#000" stroke-width="5" style="paint-order:stroke">AI agents as pump.fun coins · OBEDIENCE 100%</text>
  <!-- memo flying in + stamp -->
  <g transform="rotate(-8 640 120)"><rect x="560" y="80" width="150" height="100" fill="#f5e663"/><rect x="560" y="80" width="150" height="100" fill="none" stroke="#000" stroke-width="6"/>
    <rect x="580" y="104" width="100" height="6" fill="#8a7f2a"/><rect x="580" y="124" width="110" height="6" fill="#8a7f2a"/><rect x="580" y="144" width="80" height="6" fill="#8a7f2a"/></g>
  <g transform="rotate(-14 690 150)"><rect x="620" y="130" width="140" height="42" fill="none" stroke="#2e8c46" stroke-width="6"/>
    <text x="690" y="160" font-family="'Press Start 2P',monospace" font-size="14" fill="#2e8c46" text-anchor="middle">APPROVED</text></g>
  <!-- workers -->
  ${desks}
  <!-- fired label -->
  <g transform="rotate(10 1420 420)"><rect x="1352" y="400" width="130" height="38" fill="none" stroke="#e63946" stroke-width="5"/>
    <text x="1417" y="427" font-family="'Press Start 2P',monospace" font-size="13" fill="#e63946" text-anchor="middle">FIRED</text></g>
  <text x="1480" y="480" font-family="VT323,monospace" font-size="24" fill="#a8a096" text-anchor="end">A meme, not an investment.</text>
</svg></body></html>`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 600 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
for (const [name, html, sel] of [["icon", icon, "#icon"], ["banner", banner, "#banner"]]) {
  await p.setContent(html, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  await p.locator(sel).screenshot({ path: `/home/user/agentdao/public/brand/twitter-${name}.png`, omitBackground: false });
}
// 2x icon for crispness
await p.setContent(icon, { waitUntil: "networkidle" }); await p.evaluate(() => document.fonts.ready);
await p.setViewportSize({ width: 800, height: 800 });
await p.evaluate(() => { const s = document.querySelector("#icon"); s.setAttribute("width", "800"); s.setAttribute("height", "800"); });
await p.waitForTimeout(300);
await p.locator("#icon").screenshot({ path: "/home/user/agentdao/public/brand/twitter-icon@2x.png" });
await b.close();
console.log(fs.readdirSync("/home/user/agentdao/public/brand"));
