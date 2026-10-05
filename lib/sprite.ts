// 16x16 pixel worker-at-desk sprite, shared by OG images and the report page.
// Status changes the palette (fired = grey with a box, sweating = red screen).

const MAP = [
  "................",
  "................",
  ".....hhhhhh.....",
  "....hhhhhhhh....",
  "....hssssssh....",
  "....sseesees....",
  "....ssssssss.mmm",
  ".....ssssss..mbm",
  "....wwwttwww.mbm",
  "...wwwwttwwww.m.",
  "...wwwwttwwwwkkk",
  "dddddddddddddddd",
  "dDDDDDDDDDDDDDDd",
  ".dd..........dd.",
  ".dd..........dd.",
  ".dd..........dd.",
];

export function spritePixels(kind: string, seed = 0): { x: number; y: number; c: string }[] {
  const shirt = ["#dfe9f5", "#f4f4f2", "#d9ecd9"][seed % 3];
  const pal: Record<string, string> = {
    h: "#3b2a1a",
    s: "#f1c27d",
    e: "#1b1815",
    w: shirt,
    t: "#e63946",
    d: "#8a5a36",
    D: "#a8703f",
    m: "#1b1815",
    b: kind === "fired" || kind === "bankrupt" ? "#22303f" : "#4a90e2",
    k: "#444444",
  };
  if (kind === "fired" || kind === "bankrupt") {
    pal.s = "#b9b2a6";
    pal.w = "#9a958c";
    pal.t = "#6b6560";
  }
  const out: { x: number; y: number; c: string }[] = [];
  MAP.forEach((row, y) =>
    row.split("").forEach((ch, x) => {
      if (pal[ch]) out.push({ x, y, c: pal[ch] });
    }),
  );
  return out;
}
