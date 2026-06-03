import { Suspense } from "react";
import { RhcMarketsClient } from "@/components/app/RhcMarketsClient";

export default function RobinhoodChainPage() {
  return (
    <Suspense>
      <RhcMarketsClient />
    </Suspense>
  );
}
