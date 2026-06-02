"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { BadgeDollarSign, ExternalLink, ShieldAlert, Trophy } from "lucide-react";
import { formatUsd } from "@/lib/market-view";

type LiquidityProgram = {
  id: string;
  name: string;
  startsAtIso: string;
  endsAtIso: string;
  topPercentBps: number;
  rebateBps: number;
  minVolumeUsd: number;
  budgetUsd: number | null;
  status: string;
};

type LiquidityParticipant = {
  address: string;
  rank: number;
  volumeUsd: number;
  positionsCount: number;
  marketsTouched: number;
  firstPositionAtIso: string;
  lastPositionAtIso: string;
  eligible: boolean;
  rebateBps: number;
};

type LiquidityPayout = {
  id: string;
  address: string;
  amountUsd: number;
  transactionHash: string;
  chainId: number;
  createdAtIso: string;
};

type LiquidityResponse = {
  generatedAtIso: string;
  source: string;
  program: LiquidityProgram;
  participantCount: number;
  eligibleCount: number;
  rankCutoff: number;
  totalEligibleVolumeUsd: number;
  participants: LiquidityParticipant[];
  payouts: LiquidityPayout[];
};

export function LiquidityIncentivesClient() {
  const [data, setData] = useState<LiquidityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/liquidity/incentives", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()) as LiquidityResponse;
      })
      .then((nextData) => {
        setData(nextData);
        setError(null);
      })
      .catch((nextError) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(nextError instanceof Error ? nextError.message : "Liquidity incentives unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const topRows = useMemo(() => data?.participants.slice(0, 20) ?? [], [data]);

  return (
    <div className="px-[22px] py-7 max-w-[1120px] mx-auto">
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div
          className="grid h-10 w-10 place-items-center rounded-[8px] border"
          style={{ borderColor: "var(--line)", color: "var(--accent-bright)" }}
        >
          <BadgeDollarSign className="h-5 w-5" />
        </div>
        <div className="min-w-[260px] flex-1">
          <div
            className="mb-1 text-[10.5px] font-mono uppercase tracking-[0.14em]"
            style={{ color: "var(--accent-bright)" }}
          >
            Liquidity incentives
          </div>
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{ color: "var(--tx)" }}
          >
            Volume-based rebate eligibility
          </h1>
          <p className="mt-2 max-w-[760px] text-[13px] leading-relaxed" style={{ color: "var(--t2)" }}>
            Eligibility is computed from indexed positions in Postgres. Payouts
            are shown only when the backend records a confirmed transaction.
          </p>
        </div>
      </div>

      {loading && (
        <section className="panel p-5">
          <div className="text-[13px]" style={{ color: "var(--t2)" }}>
            Loading liquidity program from backend...
          </div>
        </section>
      )}

      {!loading && error && (
        <section className="panel p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 text-[#fca5a5]" />
            <div>
              <h2 className="text-[15px] font-semibold" style={{ color: "var(--tx)" }}>
                Liquidity program unavailable
              </h2>
              <p className="mt-2 max-w-[760px] text-[12.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
                No active liquidity program is configured, or the backend is not
                reachable. Adjudex does not show synthetic incentive rows.
              </p>
              <pre className="mt-3 overflow-auto rounded-[6px] border p-3 text-[11px]" style={{ borderColor: "var(--line)", color: "var(--t3)" }}>
                {error}
              </pre>
            </div>
          </div>
        </section>
      )}

      {!loading && data && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Metric label="Program" value={data.program.name} />
            <Metric label="Participants" value={data.participantCount} />
            <Metric label="Eligible" value={data.eligibleCount} />
            <Metric label="Rank cutoff" value={`Top ${data.rankCutoff}`} />
            <Metric label="Eligible volume" value={formatUsd(data.totalEligibleVolumeUsd, { compact: true })} />
          </div>

          <section className="panel p-5">
            <div className="grid gap-2 text-[12.5px]" style={{ color: "var(--t2)" }}>
              <div>
                <span className="font-mono" style={{ color: "var(--tx)" }}>{data.program.id}</span>
                {" "}runs from {new Date(data.program.startsAtIso).toLocaleString()} to{" "}
                {new Date(data.program.endsAtIso).toLocaleString()}.
              </div>
              <div>
                Eligible traders are inside the top {(data.program.topPercentBps / 100).toFixed(2)}%
                by indexed stake volume and above {formatUsd(data.program.minVolumeUsd)} minimum volume.
              </div>
              <div>
                Rebate eligibility: {(data.program.rebateBps / 100).toFixed(2)}%.
                This is not a claimable balance until a payout transaction is recorded.
              </div>
            </div>
          </section>

          <section className="panel overflow-hidden">
            <div className="panel-head">
              <span className="panel-title">
                Ranked traders
                <Trophy className="h-3.5 w-3.5" style={{ color: "var(--t4)" }} />
              </span>
              <div className="flex-1" />
              <span className="caps">{data.source}</span>
            </div>
            {topRows.length === 0 ? (
              <div className="p-5 text-[12.5px]" style={{ color: "var(--t3)" }}>
                No indexed positions inside the program window yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-[12px]">
                  <thead style={{ color: "var(--t3)" }}>
                    <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                      <Th>Rank</Th>
                      <Th>Address</Th>
                      <Th>Volume</Th>
                      <Th>Positions</Th>
                      <Th>Markets</Th>
                      <Th>Rebate</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {topRows.map((row) => (
                      <tr key={row.address} className="border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                        <Td mono>{row.rank}</Td>
                        <Td mono>{shortAddress(row.address)}</Td>
                        <Td>{formatUsd(row.volumeUsd)}</Td>
                        <Td>{row.positionsCount}</Td>
                        <Td>{row.marketsTouched}</Td>
                        <Td>{row.eligible ? `${(row.rebateBps / 100).toFixed(2)}%` : "0%"}</Td>
                        <Td>
                          <span className={`b-badge ${row.eligible ? "ok" : "ref"}`}>
                            <span className="d" />
                            {row.eligible ? "Eligible" : "Outside cutoff"}
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel overflow-hidden">
            <div className="panel-head">
              <span className="panel-title">Recorded payouts</span>
            </div>
            {data.payouts.length === 0 ? (
              <div className="p-5 text-[12.5px]" style={{ color: "var(--t3)" }}>
                No confirmed rebate payout transactions recorded for this program.
              </div>
            ) : (
              <div className="grid gap-2 p-4">
                {data.payouts.map((payout) => (
                  <div key={payout.id} className="flex flex-wrap items-center gap-3 rounded-[8px] border p-3" style={{ borderColor: "var(--line)" }}>
                    <span className="font-mono text-[12px]" style={{ color: "var(--tx)" }}>
                      {shortAddress(payout.address)}
                    </span>
                    <span className="text-[12px]" style={{ color: "var(--t2)" }}>{formatUsd(payout.amountUsd)}</span>
                    <Link href={explorerTx(payout.chainId, payout.transactionHash)} target="_blank" className="inline-flex items-center gap-1 text-[12px] underline" style={{ color: "var(--accent-bright)" }}>
                      tx <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          <p className="text-[11px] font-mono" style={{ color: "var(--t4)" }}>
            Generated at {data.generatedAtIso}
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="panel p-4">
      <div className="caps mb-2">{label}</div>
      <div className="text-[18px] font-semibold tracking-tight" style={{ color: "var(--tx)" }}>
        {value}
      </div>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-4 py-3 font-medium">{children}</th>;
}

function Td({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <td className={`px-4 py-3 ${mono ? "font-mono" : ""}`} style={{ color: "var(--t2)" }}>
      {children}
    </td>
  );
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function explorerTx(chainId: number, tx: string) {
  if (chainId === 421614) return `https://sepolia.arbiscan.io/tx/${tx}`;
  if (chainId === 42161) return `https://arbiscan.io/tx/${tx}`;
  return `https://sepolia.arbiscan.io/tx/${tx}`;
}
