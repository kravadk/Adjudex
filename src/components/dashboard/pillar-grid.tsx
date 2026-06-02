import { Bot, Coins, ShieldCheck } from "lucide-react";

// Three product pillars rendered under the homepage hero. The copy is
// derived from real product surfaces (AIJudgeVerifier V2, ParimutuelPool,
// USDC stake + faucet), not marketing language - each card should match
// a real on-chain artefact a curious reader can verify.
export function PillarGrid() {
  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-[14px] mb-4">
      <Pillar
        icon={<ShieldCheck className="w-4 h-4" />}
        accent="var(--accent-bright)"
        title="AI-judged resolution"
        body="Soft markets resolve through an optimistic AI Judge.
        Anyone can challenge inside a 2-hour window; only after the
        window closes does the verdict finalize and unlock claims.
        Every resolution is signed and pinned via Reclaim zkTLS."
        meta="AIJudgeVerifier · ProofAnchor"
      />
      <Pillar
        icon={<Coins className="w-4 h-4" />}
        accent="var(--green-tx)"
        title="Parimutuel pool - peer market"
        body="Each market is a parimutuel pool. Winners split the
        counter-pool pro-rata. No order book, no spread, no house
        position. Pool depth and your stake dilution are surfaced
        beside the bet form."
        meta="ParimutuelPool · BetQuoteVerifier"
      />
      <Pillar
        icon={<Bot className="w-4 h-4" />}
        accent="var(--accent)"
        title="Wallet-first, USDC-centered"
        body="Connect with any wagmi-compatible wallet. Test USDC
        from the in-app faucet on Sepolia, one approve per pool,
        every action is a real on-chain transaction backed by an
        ERC-8004 agent registry."
        meta="RainbowKit · ERC-8004"
      />
    </section>
  );
}

function Pillar({
  icon,
  accent,
  title,
  body,
  meta,
}: {
  icon: React.ReactNode;
  accent: string;
  title: string;
  body: string;
  meta: string;
}) {
  return (
    <div
      className="panel reveal"
      style={{ padding: "18px 18px 16px", borderColor: "var(--line)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-grid place-items-center w-7 h-7 rounded-[8px]"
          style={{
            background: "rgba(40,160,240,0.10)",
            color: accent,
            border: `1px solid ${accent}33`,
          }}
        >
          {icon}
        </span>
        <h3
          className="text-[14px] font-semibold tracking-tight"
          style={{ color: "var(--tx)" }}
        >
          {title}
        </h3>
      </div>
      <p
        className="text-[12.5px] leading-relaxed mb-3"
        style={{ color: "var(--t2)" }}
      >
        {body}
      </p>
      <div
        className="text-[10.5px] font-mono uppercase tracking-[0.08em]"
        style={{ color: "var(--t3)" }}
      >
        {meta}
      </div>
    </div>
  );
}
