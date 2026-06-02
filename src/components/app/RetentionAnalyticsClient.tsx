"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, BarChart3, ShieldAlert } from "lucide-react";

type RetentionSummary = {
  active1d: number;
  active7d: number;
  active30d: number;
  events30d: number;
};

type RetentionCohort = {
  cohortDay: string;
  cohortSize: number;
  retainedD1: number;
  retainedD7: number;
  retainedD30: number;
  retentionD1Pct: number;
  retentionD7Pct: number;
  retentionD30Pct: number;
};

type RetentionResponse = {
  generatedAtIso: string;
  source: string;
  summary: RetentionSummary;
  cohorts: RetentionCohort[];
};

export function RetentionAnalyticsClient() {
  const [data, setData] = useState<RetentionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/analytics/retention?limit=12", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()) as RetentionResponse;
      })
      .then((nextData) => {
        setData(nextData);
        setError(null);
      })
      .catch((nextError) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(nextError instanceof Error ? nextError.message : "Retention analytics unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const latestD30 = useMemo(() => data?.cohorts[0]?.retentionD30Pct ?? 0, [data]);

  return (
    <div className="px-[22px] py-7 max-w-[1120px] mx-auto">
      <div className="flex flex-wrap items-start gap-3 mb-6">
        <div
          className="grid h-10 w-10 place-items-center rounded-[8px] border"
          style={{ borderColor: "var(--line)", color: "var(--accent-bright)" }}
        >
          <BarChart3 className="h-5 w-5" />
        </div>
        <div className="min-w-[260px] flex-1">
          <div
            className="text-[10.5px] font-mono uppercase tracking-[0.14em] mb-1"
            style={{ color: "var(--accent-bright)" }}
          >
            Retention analytics
          </div>
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{ color: "var(--tx)" }}
          >
            Cohorts from backend activity events
          </h1>
          <p className="mt-2 max-w-[760px] text-[13px] leading-relaxed" style={{ color: "var(--t2)" }}>
            This page reads wallet-scoped product events from Postgres and shows
            D1, D7, and D30 retention. It does not use browser storage or
            generated analytics values.
          </p>
        </div>
      </div>

      {loading && (
        <section className="panel p-5">
          <div className="text-[13px]" style={{ color: "var(--t2)" }}>
            Loading retention cohorts from backend...
          </div>
        </section>
      )}

      {!loading && error && (
        <section className="panel p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 text-[#fca5a5]" />
            <div>
              <h2 className="text-[15px] font-semibold" style={{ color: "var(--tx)" }}>
                Retention data unavailable
              </h2>
              <p className="mt-2 max-w-[760px] text-[12.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
                The backend requires SIWE admin access and the
                user_activity_events table. Until those are configured, this
                page fails closed instead of showing estimated cohort data.
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
            <Metric label="Active 1d" value={data.summary.active1d} />
            <Metric label="Active 7d" value={data.summary.active7d} />
            <Metric label="Active 30d" value={data.summary.active30d} />
            <Metric label="Events 30d" value={data.summary.events30d} />
            <Metric label="Latest D30" value={`${latestD30}%`} />
          </div>

          <section className="panel overflow-hidden">
            <div className="panel-head">
              <span className="panel-title">
                Cohort table
                <Activity className="h-3.5 w-3.5" style={{ color: "var(--t4)" }} />
              </span>
              <div className="flex-1" />
              <span className="caps">{data.source}</span>
            </div>
            {data.cohorts.length === 0 ? (
              <div className="p-5 text-[12.5px]" style={{ color: "var(--t3)" }}>
                No retention cohorts recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-[12px]">
                  <thead style={{ color: "var(--t3)" }}>
                    <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                      <Th>Cohort</Th>
                      <Th>Users</Th>
                      <Th>D1</Th>
                      <Th>D7</Th>
                      <Th>D30</Th>
                      <Th>D1 %</Th>
                      <Th>D7 %</Th>
                      <Th>D30 %</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cohorts.map((cohort) => (
                      <tr key={cohort.cohortDay} className="border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                        <Td mono>{cohort.cohortDay}</Td>
                        <Td>{cohort.cohortSize}</Td>
                        <Td>{cohort.retainedD1}</Td>
                        <Td>{cohort.retainedD7}</Td>
                        <Td>{cohort.retainedD30}</Td>
                        <Td>{cohort.retentionD1Pct}%</Td>
                        <Td>{cohort.retentionD7Pct}%</Td>
                        <Td>{cohort.retentionD30Pct}%</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
      <div className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--tx)" }}>
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
