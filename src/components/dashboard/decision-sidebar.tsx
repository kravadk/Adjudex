import { CheckCircle2, ChevronRight, Wallet2 } from "lucide-react";

type Props = {
  category: string;
  poolDepthUsd: number;
  resolvesInMs: number;
  oracleType: "chainlink-price" | "zktls-ai-oracle" | "manual";
  isResolved: boolean;
};

// Decision-support sidebar - rendered beside the bet form on /market/:id.
// Mirrors polygaming.xyz's "Use this page to make a trading decision"
// sidebar pattern, adapted to Adjudex primitives:
//   - "Good fit if" rules computed from the actual market (category,
//     pool depth threshold, resolution method, time to resolve)
//   - "Next steps" ordered checklist matching our resolution lifecycle:
//     inspect resolution context -> check pool depth -> place position
//
// Output is intentionally deterministic - no marketing language.
export function DecisionSidebar({
  category,
  poolDepthUsd,
  resolvesInMs,
  oracleType,
  isResolved,
}: Props) {
  const fits = buildFits({
    category,
    poolDepthUsd,
    resolvesInMs,
    oracleType,
    isResolved,
  });
  const goodFitCount = fits.filter((f) => f.ok).length;

  return (
    <aside
      className="panel"
      style={{ padding: 0, borderColor: "var(--line)" }}
    >
      <div
        className="px-4 py-3 border-b"
        style={{ borderColor: "var(--line-soft)" }}
      >
        <div
          className="text-[10.5px] font-mono uppercase tracking-[0.08em] font-semibold"
          style={{ color: "var(--t2)" }}
        >
          Decision support
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: "var(--t3)" }}>
          {goodFitCount}/{fits.length} signals favour opening a position.
        </div>
      </div>

      <div className="px-4 py-3">
        <div
          className="text-[10.5px] font-mono uppercase tracking-[0.08em] mb-2"
          style={{ color: "var(--t3)" }}
        >
          Good fit if
        </div>
        <ul className="space-y-1.5">
          {fits.map((f) => (
            <li
              key={f.label}
              className="flex items-start gap-2 text-[12px] leading-relaxed"
            >
              <span
                className="inline-grid place-items-center w-4 h-4 rounded-full flex-shrink-0 mt-[3px]"
                style={{
                  background: f.ok
                    ? "rgba(95,194,149,0.15)"
                    : "rgba(150,145,140,0.10)",
                  color: f.ok ? "var(--green-tx)" : "var(--t3)",
                }}
              >
                <CheckCircle2 className="w-3 h-3" />
              </span>
              <div className="min-w-0">
                <div style={{ color: f.ok ? "var(--tx)" : "var(--t3)" }}>
                  {f.label}
                </div>
                {f.detail && (
                  <div
                    className="text-[10.5px] font-mono tabular-nums"
                    style={{ color: "var(--t3)" }}
                  >
                    {f.detail}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div
        className="px-4 py-3 border-t"
        style={{ borderColor: "var(--line-soft)" }}
      >
        <div
          className="text-[10.5px] font-mono uppercase tracking-[0.08em] mb-2"
          style={{ color: "var(--t3)" }}
        >
          Next steps
        </div>
        <ol className="space-y-2">
          <NextStep
            n={1}
            label="Inspect resolution context"
            detail="Read sources, evidence hash, and proposer history."
          />
          <NextStep
            n={2}
            label="Check pool depth and dilution"
            detail="Make sure your stake is a small share of the pool."
          />
          <NextStep
            n={3}
            label="Place your position"
            detail="Connect wallet, approve once, submit your USDC stake."
            icon={<Wallet2 className="w-3 h-3" />}
          />
        </ol>
      </div>
    </aside>
  );
}

type Fit = { label: string; ok: boolean; detail?: string };

function buildFits(input: Props): Fit[] {
  const hoursToResolve = input.resolvesInMs / (1000 * 60 * 60);
  const oracleLabel =
    input.oracleType === "chainlink-price"
      ? "Chainlink price feed"
      : input.oracleType === "zktls-ai-oracle"
        ? "AI Judge + zkTLS"
        : "manual resolver";
  return [
    {
      label: "You understand the category and resolution method.",
      ok: input.category !== "soft",
      detail: `${input.category} · resolves via ${oracleLabel}`,
    },
    {
      label: "Pool depth is non-trivial.",
      ok: input.poolDepthUsd >= 50,
      detail: `Pool capacity $${Math.round(input.poolDepthUsd).toLocaleString()}`,
    },
    {
      label: "Resolution timing is comfortable.",
      ok: !input.isResolved && hoursToResolve > 0.5,
      detail: input.isResolved
        ? "already resolved"
        : hoursToResolve > 0.5
          ? `${Math.round(hoursToResolve)}h until lock`
          : "very close to lock",
    },
    {
      label: "You prefer a wallet-first, USDC-centered workflow.",
      ok: true,
      detail: "Always true for Adjudex - no custody, no deposits.",
    },
  ];
}

function NextStep({
  n,
  label,
  detail,
  icon,
}: {
  n: number;
  label: string;
  detail: string;
  icon?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2 text-[12px] leading-relaxed">
      <span
        className="inline-grid place-items-center w-5 h-5 rounded-full flex-shrink-0 mt-[1px] text-[10.5px] font-mono"
        style={{
          background: "var(--card-inner)",
          border: "1px solid var(--line)",
          color: "var(--accent-bright)",
        }}
      >
        {icon ?? n}
      </span>
      <div className="min-w-0 flex-1">
        <div style={{ color: "var(--tx)" }}>{label}</div>
        <div className="text-[10.5px]" style={{ color: "var(--t3)" }}>
          {detail}
        </div>
      </div>
      <ChevronRight
        className="w-3 h-3 flex-shrink-0 mt-[3px]"
        style={{ color: "var(--t4)" }}
      />
    </li>
  );
}
