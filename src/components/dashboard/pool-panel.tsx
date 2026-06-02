import { Layers } from "lucide-react";

type Props = {
  yesPoolUsd: number;
  noPoolUsd: number;
  draftStakeUsd?: number;
  draftSide?: "YES" | "NO";
};

// Pool-depth / pool-capacity panel - the parimutuel-native replacement
// for CLOB "liquidity & spread". Surfaces:
//   - Pool TVL (yes + no), with each side's share
//   - Stake dilution preview (your stake / new total)
//   - Conviction ratio (YES share of pool = implied probability)
//
// Intentionally avoids "spread", "bid", "ask", "order book" language -
// none of those concepts exist in a parimutuel pool.
export function PoolPanel({
  yesPoolUsd,
  noPoolUsd,
  draftStakeUsd,
  draftSide,
}: Props) {
  const total = Math.max(0, yesPoolUsd) + Math.max(0, noPoolUsd);
  const yesShare = total > 0 ? yesPoolUsd / total : 0.5;
  const stake = Number.isFinite(draftStakeUsd ?? NaN)
    ? Math.max(0, draftStakeUsd ?? 0)
    : 0;
  const previewTotal = total + stake;
  const previewYes = draftSide === "YES" ? yesPoolUsd + stake : yesPoolUsd;
  const previewNo = draftSide === "NO" ? noPoolUsd + stake : noPoolUsd;
  void previewNo;
  const previewYesShare =
    previewTotal > 0 ? previewYes / previewTotal : yesShare;
  const dilution =
    stake > 0 && previewTotal > 0 ? stake / previewTotal : null;

  return (
    <div className="panel" style={{ padding: 0, borderColor: "var(--line)" }}>
      <div
        className="px-4 py-3 border-b flex items-center gap-2"
        style={{ borderColor: "var(--line-soft)" }}
      >
        <Layers
          className="w-3.5 h-3.5"
          style={{ color: "var(--accent-bright)" }}
        />
        <div>
          <div
            className="text-[10.5px] font-mono uppercase tracking-[0.08em] font-semibold"
            style={{ color: "var(--t2)" }}
          >
            Pool depth
          </div>
          <div className="text-[11px]" style={{ color: "var(--t3)" }}>
            Peer pool · no order book
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        <div>
          <div
            className="text-[11px] font-mono tabular-nums"
            style={{ color: "var(--t3)" }}
          >
            Total pool capacity
          </div>
          <div
            className="text-[22px] font-mono tabular-nums font-semibold"
            style={{ color: "var(--tx)" }}
          >
            ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>

        <DepthBar yesPoolUsd={yesPoolUsd} noPoolUsd={noPoolUsd} />

        <div className="grid grid-cols-2 gap-3">
          <PoolSideCell
            label="YES side"
            usd={yesPoolUsd}
            share={yesShare}
            color="var(--green-tx)"
          />
          <PoolSideCell
            label="NO side"
            usd={noPoolUsd}
            share={1 - yesShare}
            color="#ef4444"
          />
        </div>

        <PlatformFeeNote />

        {stake > 0 && draftSide && (
          <div
            className="rounded-[8px] px-3 py-2.5"
            style={{
              background: "rgba(40,160,240,0.06)",
              border: "1px solid rgba(40,160,240,0.20)",
            }}
          >
            <div
              className="text-[10.5px] font-mono uppercase tracking-[0.08em] mb-1"
              style={{ color: "var(--accent-bright)" }}
            >
              Dilution preview · {draftSide} ${stake.toLocaleString()}
            </div>
            <div
              className="text-[12px] leading-relaxed"
              style={{ color: "var(--t2)" }}
            >
              YES share moves{" "}
              <span className="font-mono" style={{ color: "var(--tx)" }}>
                {Math.round(yesShare * 1000) / 10}%
              </span>{" "}
              →{" "}
              <span
                className="font-mono"
                style={{ color: "var(--accent-bright)" }}
              >
                {Math.round(previewYesShare * 1000) / 10}%
              </span>
              . Your stake is{" "}
              <span className="font-mono">
                {dilution ? (dilution * 100).toFixed(2) + "%" : "—"}
              </span>{" "}
              of the new pool.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DepthBar({
  yesPoolUsd,
  noPoolUsd,
}: {
  yesPoolUsd: number;
  noPoolUsd: number;
}) {
  const total = Math.max(0, yesPoolUsd) + Math.max(0, noPoolUsd);
  const yesPct = total > 0 ? (yesPoolUsd / total) * 100 : 50;
  return (
    <div
      className="relative h-2 rounded-full overflow-hidden"
      style={{ background: "var(--line)" }}
    >
      <div
        className="absolute inset-y-0 left-0"
        style={{
          width: `${yesPct}%`,
          background: "var(--green-tx)",
          transition: "width 0.3s ease",
        }}
      />
    </div>
  );
}

function PoolSideCell({
  label,
  usd,
  share,
  color,
}: {
  label: string;
  usd: number;
  share: number;
  color: string;
}) {
  return (
    <div
      className="rounded-[8px] px-3 py-2.5"
      style={{
        background: "var(--card-inner)",
        border: "1px solid var(--line)",
      }}
    >
      <div
        className="text-[10.5px] font-mono uppercase tracking-[0.08em]"
        style={{ color }}
      >
        {label}
      </div>
      <div
        className="text-[16px] font-mono tabular-nums font-semibold mt-0.5"
        style={{ color: "var(--tx)" }}
      >
        ${Math.max(0, usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </div>
      <div
        className="text-[11px] font-mono tabular-nums"
        style={{ color: "var(--t3)" }}
      >
        {(share * 100).toFixed(1)}% of pool
      </div>
    </div>
  );
}

// Platform-fee transparency note. Default 150 bps (1.5%), overridable via
// NEXT_PUBLIC_PLATFORM_FEE_BPS. Renders nothing if fee is set to 0.
function PlatformFeeNote() {
  const bps = Number(process.env.NEXT_PUBLIC_PLATFORM_FEE_BPS ?? "150");
  if (!Number.isFinite(bps) || bps <= 0) return null;
  const pct = (bps / 100).toFixed(2);
  return (
    <div
      className="text-[10.5px] font-mono tracking-[0.04em]"
      style={{ color: "var(--t3)" }}
    >
      Platform fee · {pct}% taken from winning claims only. Losing
      positions are not charged. <code>refundAfterGrace</code> is fee-free.
    </div>
  );
}
