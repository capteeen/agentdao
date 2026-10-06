import type { Metadata } from "next";
import AgentView from "@/components/AgentView";
import { createWorld } from "@/lib/sim";

// sim: the initial world is deterministic (seed 1337) so the server can name
// agents in metadata. live: read the agent from the database.
const seedWorld = createWorld(1337, 0);
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  let a = seedWorld.agents[params.id];
  if (process.env.NEXT_PUBLIC_BOSS_BACKEND === "live") {
    const { getAgent, openDb } = await import("@/server/db");
    openDb();
    a = getAgent(params.id) ?? a;
  }
  if (!a) return { title: "Agent" };
  const og = `/api/og/report?${new URLSearchParams({ n: a.name, t: a.ticker, i: a.image, p: a.pnl7d.toFixed(2), o: "100", f: a.feesPaidToHolders.toFixed(2), h: String(a.holders), g: "B", s: String(a.seed), k: "working" })}`;
  return {
    title: `$${a.ticker}`,
    description: `${a.name}: ${a.rules.strategy} on ${a.rules.risk} risk. Holders vote, it obeys.`,
    openGraph: { images: [og] },
    twitter: { card: "summary_large_image", images: [og] },
  };
}

export default function Page({ params }: { params: { id: string } }) {
  return <AgentView id={params.id} />;
}
