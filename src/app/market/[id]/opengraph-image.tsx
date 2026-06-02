import { ImageResponse } from "next/og";
import { requireBackendUrl } from "@/lib/server/backend-api";
import type { Market } from "@/lib/types/domain";

export const runtime = "nodejs";
export const alt = "Adjudex market";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let market: Market | null = null;
  try {
    const res = await fetch(
      `${requireBackendUrl()}/api/markets/${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    if (res.ok) market = (await res.json()) as Market;
  } catch {
    // fall through — render generic card
  }

  const title = market?.title ?? "Adjudex prediction market";
  const yesProb = market?.yesProbability ?? 50;
  const noProb = 100 - yesProb;
  const volume = market?.volumeUsd ?? 0;
  const category = market?.category ?? "—";
  const isEsports = market?.category === "esports";
  const teamA = market?.teamA;
  const teamB = market?.teamB;
  const tournament = market?.tournament;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          color: "#fafafa",
          display: "flex",
          flexDirection: "column",
          padding: 56,
          fontFamily: "Arial",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              fontSize: 38,
              width: 76,
              height: 76,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 16,
              background: "#28a0f0",
              color: "#0a0a0a",
              fontWeight: 800,
            }}
          >
            P
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: 22,
                color: "#28a0f0",
                letterSpacing: 2,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Adjudex · Parimutuel terminal
            </div>
            <div style={{ display: "flex", marginTop: 4, fontSize: 20, color: "#a3a3a3" }}>
              {category}
              {tournament ? ` · ${tournament}` : ""}
            </div>
          </div>
        </div>

        {isEsports && (teamA || teamB) ? (
          <div
            style={{
              display: "flex",
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 36,
              marginTop: 24,
            }}
          >
            <TeamBlock name={teamA ?? "TBD"} prob={yesProb} accent="#10b981" />
            <div style={{ display: "flex", fontSize: 44, color: "#525252", fontWeight: 700 }}>vs</div>
            <TeamBlock name={teamB ?? "TBD"} prob={noProb} accent="#ef4444" />
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flex: 1,
              alignItems: "center",
              fontSize: 56,
              lineHeight: 1.1,
              fontWeight: 700,
              marginTop: 24,
            }}
          >
            {title.length > 140 ? `${title.slice(0, 137)}…` : title}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid #262626",
            paddingTop: 24,
            marginTop: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", fontSize: 32, color: "#10b981", fontWeight: 700 }}>
              YES {yesProb}%
            </div>
            <div style={{ display: "flex", fontSize: 32, color: "#525252" }}>·</div>
            <div style={{ display: "flex", fontSize: 32, color: "#ef4444", fontWeight: 700 }}>
              NO {noProb}%
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 22, color: "#a3a3a3" }}>
            ${Math.round(volume).toLocaleString("en-US")} pool · AI-judged
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

function TeamBlock({
  name,
  prob,
  accent,
}: {
  name: string;
  prob: number;
  accent: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        padding: 24,
        borderRadius: 16,
        border: `1px solid ${accent}55`,
        background: `${accent}11`,
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: name.length > 14 ? 36 : 44,
          fontWeight: 800,
          color: "#fafafa",
          textAlign: "center",
        }}
      >
        {name}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 12,
          fontSize: 56,
          fontWeight: 800,
          color: accent,
        }}
      >
        {prob}%
      </div>
    </div>
  );
}
