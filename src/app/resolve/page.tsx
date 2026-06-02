import { Suspense } from "react";
import { ResolutionClient } from "@/components/app/ResolutionClient";

export const metadata = {
  title: "AI Resolver - PariAI",
  description:
    "Resolve a market through configured source evidence and a signed verifier proposal.",
};

export default function ResolvePage() {
  return (
    <Suspense>
      <ResolutionClient />
    </Suspense>
  );
}
