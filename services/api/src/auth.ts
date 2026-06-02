import { randomBytes } from "node:crypto";

export const sessionCookieName = "adjudex_session";
export const nonceTtlMs = 15 * 60 * 1000;
export const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
export const defaultSiweDomain = "adjudex.app";

export function createToken(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

export function buildSiweMessage(input: {
  domain: string;
  address: string;
  chainId: number;
  nonce: string;
  issuedAtIso: string;
}) {
  return [
    `${input.domain} wants you to sign in with your Ethereum account:`,
    input.address,
    "",
    "Sign in to Adjudex to manage settings, watchlist, and notifications.",
    "",
    "URI: https://adjudex.app",
    "Version: 1",
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAtIso}`,
  ].join("\n");
}

export function configuredSiweDomain(env: Partial<NodeJS.ProcessEnv> = process.env) {
  const configured = env.SIWE_DOMAIN ?? env.NEXT_PUBLIC_APP_URL ?? env.PUBLIC_APP_URL ?? env.RECLAIM_PUBLIC_BASE_URL;
  return normalizeSiweDomain(configured) ?? defaultSiweDomain;
}

function normalizeSiweDomain(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return url.host || null;
  } catch {
    return null;
  }
}

export function isNonceExpired(createdAt: Date, now = new Date()) {
  return now.getTime() - createdAt.getTime() > nonceTtlMs;
}

export function parseCookie(header: string | undefined, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function sessionCookie(token: string) {
  const maxAge = Math.floor(sessionTtlMs / 1000);
  return `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookieAttribute()}`;
}

export function expiredSessionCookie() {
  return `${sessionCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookieAttribute()}`;
}

function secureCookieAttribute() {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

// Admin allowlist — operator addresses authorised to call privileged
// importer / admin endpoints. Reads from `IMPORT_ADMIN_ADDRESSES`
// (preferred) or legacy `ADMIN_WALLET_ADDRESSES` env as a comma-separated
// list. Empty list = admin endpoints locked entirely (preferred default
// for unconfigured environments).
export function parseAdminAllowlist(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): Set<string> {
  const raw =
    (env.IMPORT_ADMIN_ADDRESSES ?? env.ADMIN_WALLET_ADDRESSES ?? "").trim();
  if (!raw) return new Set();
  const set = new Set<string>();
  for (const part of raw.split(",")) {
    const candidate = part.trim().toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(candidate)) set.add(candidate);
  }
  return set;
}

export function isAdminAddress(
  address: string | null | undefined,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): boolean {
  if (!address) return false;
  const list = parseAdminAllowlist(env);
  return list.has(address.toLowerCase());
}
