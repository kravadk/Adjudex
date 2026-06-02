"use client";

import { CreditCard, ExternalLink } from "lucide-react";
import { useAccount } from "wagmi";

// Fiat on-ramp launcher. Opens the configured provider (MoonPay or
// Transak) in a new tab, pre-filled with the user's wallet address and
// USDC on Arbitrum. The provider handles KYC + payment; funds land
// directly in the user's wallet — we never touch fiat.
//
// Configuration (all optional — the button hides if no provider key set):
//   NEXT_PUBLIC_MOONPAY_API_KEY   pk_test_... or pk_live_...
//   NEXT_PUBLIC_TRANSAK_API_KEY   transak environment key
//   NEXT_PUBLIC_FIAT_PROVIDER     "moonpay" | "transak" (default moonpay)

type Provider = "moonpay" | "transak";

function provider(): Provider {
  const raw = (process.env.NEXT_PUBLIC_FIAT_PROVIDER ?? "moonpay").toLowerCase();
  return raw === "transak" ? "transak" : "moonpay";
}

function moonpayUrl(address: string | undefined): string | null {
  const apiKey = process.env.NEXT_PUBLIC_MOONPAY_API_KEY;
  if (!apiKey) return null;
  const params = new URLSearchParams({
    apiKey,
    currencyCode: "usdc_arbitrum",
    baseCurrencyCode: "usd",
    redirectURL: typeof window !== "undefined" ? window.location.origin : "",
  });
  if (address) params.set("walletAddress", address);
  return `https://buy.moonpay.com?${params.toString()}`;
}

function transakUrl(address: string | undefined): string | null {
  const apiKey = process.env.NEXT_PUBLIC_TRANSAK_API_KEY;
  if (!apiKey) return null;
  const params = new URLSearchParams({
    apiKey,
    cryptoCurrencyCode: "USDC",
    network: "arbitrum",
    defaultFiatCurrency: "USD",
    productsAvailed: "BUY",
  });
  if (address) params.set("walletAddress", address);
  return `https://global.transak.com?${params.toString()}`;
}

function buildUrl(p: Provider, address: string | undefined): string | null {
  return p === "transak" ? transakUrl(address) : moonpayUrl(address);
}

export function FiatOnrampButton({
  variant = "primary",
}: {
  variant?: "primary" | "ghost";
}) {
  const { address } = useAccount();
  const p = provider();
  const url = buildUrl(p, address);
  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`btn ${variant === "ghost" ? "ghost" : "primary"} inline-flex items-center gap-2`}
      title={`Buy USDC via ${p === "transak" ? "Transak" : "MoonPay"}`}
    >
      <CreditCard className="w-3.5 h-3.5" />
      Buy USDC with card
      <ExternalLink className="w-3 h-3 opacity-70" />
    </a>
  );
}

// Smaller text-link variant for inline use in copy paragraphs.
export function FiatOnrampLink() {
  const { address } = useAccount();
  const url = buildUrl(provider(), address);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="underline inline-flex items-center gap-1"
      style={{ color: "var(--accent-bright)" }}
    >
      Buy USDC with card <ExternalLink className="w-3 h-3" />
    </a>
  );
}
