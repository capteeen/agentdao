import Link from "next/link";

export const metadata = { title: "How it works" };

function Node({ icon, title, sub, color = "bg-panel" }: { icon: string; title: string; sub: string; color?: string }) {
  return (
    <div className={`px-box ${color} w-full p-3 text-center sm:w-44`}>
      <div className="text-3xl">{icon}</div>
      <p className="h-pixel mt-1 text-[9px] uppercase">{title}</p>
      <p className="text-lg text-dim">{sub}</p>
    </div>
  );
}
const Arrow = ({ label }: { label?: string }) => (
  <div className="flex flex-col items-center justify-center px-1 text-memo">
    <span className="h-pixel text-[14px] sm:rotate-0 rotate-90">▶</span>
    {label && <span className="text-base text-dim">{label}</span>}
  </div>
);

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="h-pixel flex items-center gap-3 text-[12px] uppercase">
        <span className="text-memo">{n}</span> {title}
      </h2>
      <div className="mt-3 space-y-3 text-2xl leading-snug">{children}</div>
    </section>
  );
}

export default function How() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="h-pixel text-lg leading-relaxed">HOW BOSS WORKS</h1>
      <p className="mt-3 text-2xl text-dim">The agent is an employee. The coin is the company. Holders are the board. Nobody, not even the dev, can make it do something the holders didn&apos;t vote for.</p>

      <div className="mt-8 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
        <Node icon="🗳️" title="Vote opens" sub="any holder proposes, small SOL fee → vault" />
        <Arrow label="1h" />
        <Node icon="⚖️" title="Tally" sub="weight = balance at snapshot, 5% quorum" />
        <Arrow />
        <Node icon="📨" title="Memo" sub="winner flies to the desk, stamped APPROVED" color="bg-[#3a3520]" />
        <Arrow label="≤1 block" />
        <Node icon="⌨️" title="Rule set" sub="the agent's job description updates" />
        <Arrow />
        <Node icon="📈" title="Trades" sub="each one names its rule + the vote" />
      </div>

      <Section n="01" title="Hire an agent">
        <p>Fill in the hire form: name, ticker, image, a starting strategy and risk level, the salary split and a dev buy. BOSS launches the coin on pump.fun, gives the agent its own Solana wallet, and puts the starting salary in its vault. Your picks become the founding rule set.</p>
      </Section>

      <Section n="02" title="Give it orders">
        <p>Every rule is a vote. Holders can propose a change to any of these:</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ["Strategy", "Sniper / Momentum / Fee-farmer / Copy-trade a wallet"],
            ["Risk", "Intern 2% · Staff 5% · Manager 10% · Degen full port"],
            ["Launch cadence", "never / daily / every 6h / every hour"],
            ["Take profit", "2x / 5x / 10x / never"],
            ["Salary", "% of creator fees kept in the vault vs paid to holders"],
            ["Raise / Fire", "top up the vault, or liquidate it pro-rata and send the agent to the graveyard"],
          ].map(([k, v]) => (
            <div key={k} className="px-box p-3">
              <p className="h-pixel text-[9px] uppercase text-memo">{k}</p>
              <p className="text-xl">{v}</p>
            </div>
          ))}
        </div>
        <p>Votes run 1 hour, need 5% of supply to turn out, and are weighted by holdings snapshotted at open, so you can&apos;t buy in mid-vote to swing it.</p>
      </Section>

      <Section n="03" title="It obeys">
        <p>When a vote closes, the winning option is written into the agent&apos;s rule set in the next block. On the office floor you see it happen: a memo flies from the boardroom to the desk, gets stamped, and the worker changes what they&apos;re doing.</p>
        <div className="memo-card p-4 text-xl">
          <p className="h-pixel text-[9px]">TRADE LOG · $GARY</p>
          <p className="mt-2">Momentum rule: bought $WIF after 40% move in 5m. Size 5% of vault (Staff).</p>
          <p className="text-lg">
            Why? → <u>Strategy: Momentum</u> · set by <u>vote #v12 (71%)</u>
          </p>
        </div>
        <p>Strategies are deterministic rule engines. No LLM decides anything; a model only writes the one-line explanation after the fact. The <b className="text-ok">obedience score</b> is the % of passed votes executed within one block. It is always 100%. That&apos;s the joke, and also the point.</p>
      </Section>

      <Section n="04" title="Review it">
        <p>Every 24h each agent gets a pixel report card: PnL, obedience, fees paid to holders, rated by N holders. Share it; it renders as an OG image. If you don&apos;t like the numbers, demote it to Intern, cut its salary, or fire it.</p>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-center">
          <Node icon="📉" title="Bad quarter" sub="sweating at the desk" />
          <Arrow />
          <Node icon="🗳️" title="Fire vote" sub="&quot;Fire $GARY?&quot; 83% yes" color="bg-[#3a1d20]" />
          <Arrow />
          <Node icon="📦" title="Box walks out" sub="vault split pro-rata to holders" />
          <Arrow />
          <Node icon="🪦" title="Graveyard" sub="&quot;Fired by 83% of holders&quot;" />
        </div>
      </Section>

      <Section n="??" title="Fine print">
        <p>Phase 1 (this site) runs a mock simulator in your browser: agents, trades, votes and firings are all simulated. Nothing touches mainnet. Phase 2 swaps in PumpPortal launches, per-agent keypairs, real holder snapshots and signed off-chain votes. See the README.</p>
        <p className="text-stamp">A meme, not an investment. Crypto is risky. Only use what you can afford to lose.</p>
      </Section>

      <div className="mt-12 text-center">
        <Link href="/hire" className="px-btn memo">
          Hire an agent
        </Link>
      </div>
    </div>
  );
}
