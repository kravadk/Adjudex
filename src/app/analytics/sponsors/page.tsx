import type { Metadata } from "next";
import { SponsorTractionClient } from "@/components/app/SponsorTractionClient";

export const metadata: Metadata = {
  title: "Proof of traction — Adjudex",
  description: "Public, on-chain-derived traction metrics across every chain Adjudex runs on.",
};

export default function SponsorTractionPage() {
  return <SponsorTractionClient />;
}
