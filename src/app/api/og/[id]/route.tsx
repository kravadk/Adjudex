import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { requireBackendUrl } from "@/lib/server/backend-api";
import type { Market } from "@/lib/types/domain";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let market: Market;

  try {
    const response = await fetch(`${requireBackendUrl()}/api/markets/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({ error: "market_unavailable" }, { status: response.status });
    }

    market = (await response.json()) as Market;
  } catch (error) {
    return NextResponse.json(
      {
        error: "backend_not_configured",
        message: error instanceof Error ? error.message : "Backend API is unavailable.",
      },
      { status: 503 }
    );
  }

  const pool = market.poolAddress
    ? `${market.poolAddress.slice(0, 8)}...${market.poolAddress.slice(-6)}`
    : "pending";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#050505",
          color: "#fafafa",
          padding: 64,
          fontFamily: "Arial",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              fontSize: 48,
              width: 104,
              height: 104,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 20,
              background: "#1c1c1c",
              color: "#CCE9E7",
              fontWeight: 700,
            }}
          >
            P
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 28, color: "#CCE9E7", letterSpacing: 2, textTransform: "uppercase" }}>
              PariAI proof market
            </div>
            <div style={{ display: "flex", marginTop: 8, fontSize: 24, color: "#a3a3a3" }}>
              {market.category} - {market.asset} - {market.status}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 68, lineHeight: 1.05, fontWeight: 700 }}>{market.title}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", fontSize: 44, color: "#00c805", fontWeight: 700 }}>{market.yesProbability}% YES</div>
            <div style={{ display: "flex", fontSize: 28, color: "#a3a3a3" }}>
              ${market.volumeUsd.toLocaleString("en-US")} volume - {market.aiLpCount} AI LPs
            </div>
          </div>
          <div style={{ display: "flex", gap: 18, fontSize: 22, color: "#d4d4d4" }}>
            <div style={{ display: "flex", padding: "12px 16px", border: "1px solid #262626", borderRadius: 10 }}>
              Chain {market.chainId ?? "unindexed"}
            </div>
            <div style={{ display: "flex", padding: "12px 16px", border: "1px solid #262626", borderRadius: 10 }}>
              Pool {pool}
            </div>
            <div style={{ display: "flex", padding: "12px 16px", border: "1px solid #262626", borderRadius: 10, color: "#CCE9E7" }}>
              Indexed proof
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
