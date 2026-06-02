"use client";

import Link from "next/link";
import { useState } from "react";

// Jurisdiction + ToS acceptance banner. It can be dismissed for the
// current app session, but it does not write browser-persisted state.
export function JurisdictionBanner() {
  const [accepted, setAccepted] = useState<boolean>(false);

  if (accepted) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t"
      style={{
        background: "rgba(10,10,10,0.96)",
        borderColor: "var(--line)",
        backdropFilter: "blur(8px)",
      }}
      role="region"
      aria-label="Jurisdiction disclaimer"
    >
      <div className="max-w-[1280px] mx-auto px-5 py-3 flex flex-wrap items-center gap-3">
        <div
          className="text-[12px] leading-relaxed flex-1 min-w-[260px]"
          style={{ color: "var(--t2)" }}
        >
          PariAI is a non-custodial parimutuel protocol on Arbitrum. It is{" "}
          <span className="font-semibold" style={{ color: "var(--tx)" }}>
            not available
          </span>{" "}
          to residents of the United States, Cuba, Iran, North Korea, Syria,
          Russia, or Belarus. Trading involves real risk of total loss. By
          using PariAI you accept the{" "}
          <Link
            href="/legal/terms"
            className="underline"
            style={{ color: "var(--accent-bright)" }}
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            href="/legal/privacy"
            className="underline"
            style={{ color: "var(--accent-bright)" }}
          >
            Privacy Policy
          </Link>
          .
        </div>
        <button
          type="button"
          onClick={() => setAccepted(true)}
          className="btn primary"
          style={{ height: 34, padding: "0 18px", fontSize: 12 }}
        >
          I understand
        </button>
      </div>
    </div>
  );
}
