"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { backend } from "@/lib/backend";
import { CADENCES, LABEL, RISK_DESC, RISKS, STRATEGIES, STRATEGY_DESC, TAKE_PROFITS } from "@/lib/rules";
import type { Cadence, Risk, Strategy, TakeProfit } from "@/lib/types";
import { useMyWallet } from "@/components/Providers";
import { WalletButton } from "@/components/Chrome";
import Face from "@/components/Face";
import Office from "@/components/Office";
import { useBoss } from "@/lib/store";

const EMOJI = ["🧑‍💼", "👩‍💼", "👨‍💼", "🤖", "🦊", "🐸", "🐶", "🐱", "🐻", "🐵", "🦉", "🐷"];
const CREATE_FEE = 0.02; // pump.fun create (rent + network), approximate
const NETWORK_FEE = 0.001;

function Choice<T extends string>({ label, value, options, onChange, desc }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void; desc?: (v: T) => string }) {
  return (
    <div>
      <p className="h-pixel mb-2 text-[8px] uppercase text-dim">{label}</p>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {options.map((o) => (
          <button key={o} type="button" onClick={() => onChange(o)} className={`tag !py-2 ${value === o ? "!bg-memo !text-[#1b1815]" : ""}`}>
            {LABEL[o] ?? o}
          </button>
        ))}
      </div>
      {desc && <p className="mt-1 text-lg text-dim">{desc(value)}</p>}
    </div>
  );
}

export default function HirePage() {
  const router = useRouter();
  const ready = useBoss((s) => s.ready);
  const { address, isDemo } = useMyWallet();
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [image, setImage] = useState(EMOJI[0]);
  const [strategy, setStrategy] = useState<Strategy>("momentum");
  const [risk, setRisk] = useState<Risk>("staff");
  const [cadence, setCadence] = useState<Cadence>("never");
  const [takeProfit, setTakeProfit] = useState<TakeProfit>("2x");
  const [salary, setSalary] = useState(50);
  const [copyWallet, setCopyWallet] = useState("");
  const [devBuy, setDevBuy] = useState(0.5);
  const [vault, setVault] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const total = CREATE_FEE + NETWORK_FEE + devBuy + vault;
  const valid = name.trim().length >= 2 && /^[A-Za-z0-9_]{2,10}$/.test(ticker) && vault >= 0.1 && (strategy !== "copytrade" || copyWallet.length >= 32);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1_000_000) return setErr("Image must be under 1MB");
    const r = new FileReader();
    r.onload = () => setImage(String(r.result));
    r.readAsDataURL(f);
  };

  const submit = async () => {
    if (!address || !valid) return;
    setBusy(true);
    setErr("");
    try {
      const id = await backend.hire(
        { name: name.trim(), ticker: ticker.toUpperCase(), image, rules: { strategy, risk, cadence, takeProfit, salaryPct: salary, copyWallet: strategy === "copytrade" ? copyWallet : undefined }, devBuySol: devBuy, startingVaultSol: vault },
        address,
      );
      router.push(`/agent/${id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      {/* dimmed office behind the modal */}
      <div className="pointer-events-none absolute inset-0 opacity-30">{ready && <Office height="100%" interactive={false} />}</div>
      <div className="relative mx-auto max-w-xl px-4 py-8">
        <div className="px-box p-5">
          <div className="flex items-center justify-between">
            <h1 className="h-pixel text-sm">HIRE AN AGENT</h1>
            <span className="tag">Step 01</span>
          </div>
          <p className="mt-2 text-xl text-dim">Launch its coin on pump.fun. It gets a Solana wallet and a starting salary. Its first rule set is what you pick here. After that, the holders decide.</p>

          <div className="mt-5 grid grid-cols-[auto_1fr] gap-4">
            <label className="grid h-24 w-24 cursor-pointer place-items-center bg-panel2 text-5xl" title="Upload image">
              <Face image={image} />
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            <div className="space-y-2">
              <input className="w-full bg-panel2 p-2 text-xl outline-none" placeholder="Name (e.g. Gary from Accounting)" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
              <input className="w-full bg-panel2 p-2 text-xl uppercase outline-none" placeholder="TICKER" maxLength={10} value={ticker} onChange={(e) => setTicker(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {EMOJI.map((e) => (
              <button key={e} type="button" className={`px-1 text-2xl ${image === e ? "bg-memo" : ""}`} onClick={() => setImage(e)}>
                {e}
              </button>
            ))}
            <span className="ml-1 self-center text-base text-dim">or click the box to upload</span>
          </div>

          <div className="mt-5 space-y-4">
            <Choice label="Starting strategy" value={strategy} options={STRATEGIES} onChange={setStrategy} desc={(v) => STRATEGY_DESC[v]} />
            {strategy === "copytrade" && <input className="w-full bg-panel2 p-2 font-mono text-base outline-none" placeholder="Wallet to copy (base58)" value={copyWallet} onChange={(e) => setCopyWallet(e.target.value.trim())} />}
            <Choice label="Starting risk" value={risk} options={RISKS} onChange={setRisk} desc={(v) => RISK_DESC[v]} />
            <Choice label="Launch cadence" value={cadence} options={CADENCES} onChange={setCadence} />
            <Choice label="Take profit" value={takeProfit} options={TAKE_PROFITS} onChange={setTakeProfit} />
            <div>
              <p className="h-pixel mb-2 text-[8px] uppercase text-dim">Salary split (creator fees)</p>
              <input type="range" min={0} max={100} step={5} value={salary} onChange={(e) => setSalary(Number(e.target.value))} className="w-full accent-[#f5e663]" />
              <p className="text-lg">
                Agent keeps <b className="text-memo">{salary}%</b> in its vault · holders get <b className="text-ok">{100 - salary}%</b>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="h-pixel text-[8px] uppercase text-dim">Dev buy (SOL)</span>
                <input type="number" min={0} step={0.1} value={devBuy} onChange={(e) => setDevBuy(Math.max(0, Number(e.target.value)))} className="mt-1 w-full bg-panel2 p-2 text-xl outline-none" />
              </label>
              <label>
                <span className="h-pixel text-[8px] uppercase text-dim">Starting vault (SOL)</span>
                <input type="number" min={0.1} step={0.5} value={vault} onChange={(e) => setVault(Math.max(0, Number(e.target.value)))} className="mt-1 w-full bg-panel2 p-2 text-xl outline-none" />
              </label>
            </div>
          </div>

          <div className="memo-card mt-5 p-4 text-xl">
            <p className="h-pixel mb-2 text-[8px] uppercase">Cost breakdown</p>
            {(
              [
                ["pump.fun create (rent + fees)", CREATE_FEE],
                ["Dev buy (you get the tokens = votes)", devBuy],
                ["Agent starting salary → vault", vault],
                ["Network / priority fee", NETWORK_FEE],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span>{k}</span>
                <span>{v.toFixed(3)} SOL</span>
              </div>
            ))}
            <div className="mt-2 flex justify-between border-t-4 border-dashed border-[#1b1815]/30 pt-2">
              <b>Total</b>
              <b>{total.toFixed(3)} SOL</b>
            </div>
          </div>

          {err && <p className="mt-3 text-xl text-stamp">{err}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {!address ? (
              <>
                <span className="text-xl">Wallet connect required →</span>
                <WalletButton />
              </>
            ) : (
              <button className="px-btn memo w-full" disabled={!valid || busy} onClick={submit}>
                {busy ? "Launching on pump.fun…" : `Hire & launch $${ticker || "TICKER"}`}
              </button>
            )}
          </div>
          <p className="mt-3 text-base text-dim">
            Phase 1: launch is mocked{isDemo ? " (demo wallet)" : ""}. No transaction is sent and no SOL leaves your wallet. A meme, not an investment.
          </p>
        </div>
      </div>
    </div>
  );
}
