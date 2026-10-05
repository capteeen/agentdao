import { ImageResponse } from "next/og";
import { spritePixels } from "@/lib/sprite";

export const runtime = "edge";

export async function GET() {
  const P = 14;
  const desks = [0, 1, 2, 3, 4];
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#1b1815", color: "#f4f4f2", fontFamily: "monospace" }}>
        <div style={{ fontSize: 120, fontWeight: 900, color: "#f5e663", display: "flex" }}>BOSS</div>
        <div style={{ fontSize: 40, marginTop: 10, display: "flex" }}>the agent is your employee</div>
        <div style={{ display: "flex", gap: 30, marginTop: 50 }}>
          {desks.map((d) => (
            <div key={d} style={{ width: 16 * P, height: 16 * P, position: "relative", display: "flex", background: "#2a2520" }}>
              {spritePixels(d === 4 ? "fired" : "working", d).map((p, i) => (
                <div key={i} style={{ position: "absolute", left: p.x * P, top: p.y * P, width: P, height: P, background: p.c }} />
              ))}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 28, marginTop: 40, color: "#7bd389", display: "flex" }}>Holders vote. The agent obeys within one block.</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
