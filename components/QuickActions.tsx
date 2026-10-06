"use client";

import type { Agent } from "@/lib/types";
import ProposeButton from "./Propose";

/** Step 04 "Review it": one-click proposals for the three classic boss moves. */
export default function QuickActions({ agent }: { agent: Agent }) {
  if (agent.status === "fired" || agent.status === "bankrupt") return null;
  const roi = agent.pnl7d / Math.max(agent.vault, 1);
  return (
    <div className="flex flex-wrap gap-1">
      <ProposeButton agent={agent} preset="raise" label="💰 Give a raise" className="px-btn ok !text-[9px]" reasonPreset={roi > 0 ? "Up on the week. Pay the employee." : "Needs more runway."} />
      <ProposeButton agent={agent} preset="risk" label="📉 Demote" className="px-btn ghost !text-[9px]" reasonPreset="Too much risk for these results. Back to Intern." />
      <ProposeButton agent={agent} preset="fire" label="📦 Fire" className="px-btn stamp !text-[9px]" reasonPreset={agent.lossStreak >= 3 ? `${agent.lossStreak} losses in a row. Pack the box.` : "Not a culture fit."} />
    </div>
  );
}
