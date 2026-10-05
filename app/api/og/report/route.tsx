import { ImageResponse } from "next/og";
import { spritePixels } from "@/lib/sprite";

export const runtime = "edge";

async function pixelFont(): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Press+Start+2P", { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534 (KHTML, like Gecko)" } })).text();
    const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    return await (await fetch(url)).arrayBuffer();
  } catch {
    return null;
  }
}

/** Shareable report card: sprite, PnL, obedience, "Rated by N holders". */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const name = (q.get("n") ?? "Agent").slice(0, 40);
  const ticker = (q.get("t") ?? "BOSS").slice(0, 12);
  const pnl = Number(q.get("p") ?? 0);
  const ob = q.get("o") ?? "100";
  const fees = q.get("f") ?? "0";
  const raters = q.get("h") ?? "0";
  const grade = (q.get("g") ?? "B").slice(0, 2);
  const seed = Number(q.get("s") ?? 0);
  const kind = q.get("k") ?? "working";
  const font = await pixelFont();
  const P = 22;
  const px = spritePixels(kind, seed);
  const dead = kind === "fired" || kind === "bankrupt";

  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", background: "#1b1815", padding: 40, fontFamily: font ? "PS2P" : "monospace" }}>
        <div style={{ flex: 1, display: "flex", background: "#f5e663", border: "8px solid #000", boxShadow: "16px 16px 0 #000", padding: 40, color: "#1b1815" }}>
          <div style={{ width: 16 * P + 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 16 * P, height: 16 * P, position: "relative", display: "flex", background: "#2a2520" }}>
              {px.map((p, i) => (
                <div key={i} style={{ position: "absolute", left: p.x * P, top: p.y * P, width: P, height: P, background: p.c }} />
              ))}
            </div>
            <div style={{ marginTop: 18, fontSize: 18, display: "flex" }}>{dead ? "FIRED" : "EMPLOYEE"}</div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", marginLeft: 40 }}>
            <div style={{ fontSize: 16, opacity: 0.7, display: "flex" }}>PERFORMANCE REVIEW</div>
            <div style={{ fontSize: 44, marginTop: 14, display: "flex" }}>{`$${ticker}`}</div>
            <div style={{ fontSize: 20, marginTop: 8, opacity: 0.75, display: "flex" }}>{name}</div>
            <div style={{ display: "flex", marginTop: 36, gap: 36 }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 14, opacity: 0.7, display: "flex" }}>PNL</div>
                <div style={{ fontSize: 34, marginTop: 8, display: "flex", color: pnl >= 0 ? "#2e8c46" : "#e63946" }}>{(pnl >= 0 ? "+" : "") + pnl.toFixed(2)}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 14, opacity: 0.7, display: "flex" }}>OBEDIENCE</div>
                <div style={{ fontSize: 34, marginTop: 8, display: "flex" }}>{`${ob}%`}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 14, opacity: 0.7, display: "flex" }}>FEES PAID</div>
                <div style={{ fontSize: 34, marginTop: 8, display: "flex" }}>{Number(fees).toFixed(1)}</div>
              </div>
            </div>
            <div style={{ display: "flex", marginTop: "auto", alignItems: "flex-end", justifyContent: "space-between" }}>
              <div style={{ fontSize: 18, display: "flex" }}>{`Rated by ${raters} holders`}</div>
              <div style={{ fontSize: 96, color: grade.startsWith("A") ? "#2e8c46" : grade === "F" ? "#e63946" : "#1b1815", border: "8px solid currentColor", padding: "18px 28px", lineHeight: 1, transform: "rotate(-8deg)", display: "flex" }}>{grade}</div>
            </div>
            <div style={{ fontSize: 14, marginTop: 18, opacity: 0.6, display: "flex" }}>BOSS · the agent is your employee</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts: font ? [{ name: "PS2P", data: font, style: "normal", weight: 400 }] : undefined },
  );
}
