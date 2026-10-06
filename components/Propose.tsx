"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { backend } from "@/lib/backend";
import { useBoss } from "@/lib/store";
import type { Agent, VoteField } from "@/lib/types";
import { FIELD_LABEL, optionLabel, optionsFor } from "@/lib/rules";
import { SIM } from "@/lib/sim";
import { useMyWallet } from "./Providers";
import { WalletButton } from "./Chrome";

const FIELDS: VoteField[] = ["strategy", "risk", "cadence", "takeProfit", "salaryPct", "raise", "fire"];

export function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="px-box max-h-[90vh] w-full max-w-lg overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="h-pixel text-[12px] uppercase">{title}</h2>
          <button className="h-pixel text-[12px]" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ProposeButton({ agent, preset, label = "✎ Propose", className = "px-btn memo", reasonPreset = "" }: { agent: Agent; preset?: VoteField; label?: string; className?: string; reasonPreset?: string }) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<VoteField>(preset ?? "risk");
  const [reason, setReason] = useState(reasonPreset);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { address } = useMyWallet();
  const weight = useBoss((s) => s.holdings[agent.id] ?? 0);
  const router = useRouter();

  const submit = async () => {
    if (!address) return;
    setBusy(true);
    setErr("");
    try {
      const id = await backend.propose(agent.id, field, address, reason || undefined);
      setOpen(false);
      router.push(`/vote/${id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (agent.status !== "working" && agent.status !== "idle") return null;
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <Modal title={`Propose · $${agent.ticker}`} onClose={() => setOpen(false)}>
          <p className="text-lg text-dim">Any holder can open a vote. It runs 1 hour (90s in the mock), needs 5% quorum, and the winner becomes the agent&apos;s rule.</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {FIELDS.map((f) => (
              <button key={f} onClick={() => setField(f)} className={`tag !py-2 ${field === f ? "!bg-memo !text-[#1b1815]" : ""} ${f === "fire" ? "!text-stamp" : ""}`}>
                {FIELD_LABEL[f]}
              </button>
            ))}
          </div>
          <p className="mt-3 text-lg">
            Options: {optionsFor(field).map((o) => optionLabel(field, o)).join(" / ")}
          </p>
          <textarea className="mt-3 w-full bg-panel2 p-2 text-lg outline-none" rows={2} maxLength={140} placeholder="Why? (optional, shown on the vote)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="mt-3 text-lg">
            <div className="flex justify-between">
              <span className="text-dim">Proposal fee → agent vault</span>
              <span>{SIM.PROPOSAL_FEE} SOL</span>
            </div>
            <div className="flex justify-between">
              <span className="text-dim">Your voting weight</span>
              <span>{weight ? `${(weight / 1e6).toFixed(2)}M $${agent.ticker}` : "0 (not a holder)"}</span>
            </div>
          </div>
          {err && <p className="mt-2 text-lg text-stamp">{err}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!address ? (
              <WalletButton />
            ) : (
              <button className="px-btn" disabled={busy || !weight} onClick={submit}>
                {busy ? "Signing…" : weight ? "Open vote" : "Hold the coin to propose"}
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
