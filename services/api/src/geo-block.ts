// Geo-blocking middleware. Rejects requests originating from US (CFTC/SEC
// jurisdiction) and OFAC-sanctioned countries with HTTP 451 Unavailable
// For Legal Reasons. Reads the country code from Cloudflare / Vercel /
// Fly edge headers — we never resolve IPs ourselves to avoid PII storage.
//
// Configuration:
//   GEO_BLOCK_ENABLED=1                  enable enforcement (default off)
//   GEO_BLOCKED_COUNTRIES=US,CU,IR,KP,SY,RU,BY  comma-separated ISO-3166-1 alpha-2
//   GEO_TRUST_HEADER=cf-ipcountry        which header to trust
//
// Endpoints whose path starts with /health or /api/status are NEVER
// geo-blocked so monitoring / probes always succeed.

import type { FastifyRequest, FastifyReply } from "fastify";
import { incCounter } from "./metrics";

const DEFAULT_BLOCKED = [
  "US", // CFTC / SEC — prediction markets are restricted
  "CU", "IR", "KP", "SY", // OFAC comprehensive sanctions
  "RU", "BY", // RU + BY due to EU sanctions; revisit per legal counsel
];

const ALLOWED_PATH_PREFIXES = ["/health", "/api/status", "/metrics"];

function readBlocked(): Set<string> {
  const raw = process.env.GEO_BLOCKED_COUNTRIES?.trim();
  if (!raw) return new Set(DEFAULT_BLOCKED.map((c) => c.toUpperCase()));
  return new Set(
    raw
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c)),
  );
}

function enforced(): boolean {
  return process.env.GEO_BLOCK_ENABLED === "1";
}

function trustedHeader(): string {
  return (process.env.GEO_TRUST_HEADER ?? "cf-ipcountry").toLowerCase();
}

// Returns null if request should proceed, otherwise the country code that
// caused the block. Caller is responsible for sending the 451 response.
export function geoBlockDecision(req: FastifyRequest): string | null {
  if (!enforced()) return null;
  const path = req.url ?? "";
  if (ALLOWED_PATH_PREFIXES.some((p) => path.startsWith(p))) return null;

  const headerName = trustedHeader();
  const raw = req.headers[headerName];
  // Fastify lowercases header keys; raw may be string or string[].
  const country = (Array.isArray(raw) ? raw[0] : raw ?? "").toString().toUpperCase();
  if (!country || country === "XX" || country === "T1") {
    // XX = unknown (Cloudflare default for Tor / local), T1 = Tor exit.
    // Block-on-unknown is safer for production but configurable.
    if (process.env.GEO_BLOCK_UNKNOWN === "1") return country || "XX";
    return null;
  }

  const blocked = readBlocked();
  if (blocked.has(country)) return country;
  return null;
}

export async function applyGeoBlock(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const blockedCountry = geoBlockDecision(req);
  if (!blockedCountry) return true;
  incCounter("adjudex_geo_block_total", { country: blockedCountry });
  reply.code(451).send({
    error: "geo_blocked",
    message:
      "Adjudex is not available in your jurisdiction. Prediction markets are restricted in certain regions; this is a good-faith block based on CDN-reported country. If you believe this is incorrect, see https://adjudex.xyz/legal/jurisdictions for the policy.",
    country: blockedCountry,
  });
  return false;
}
