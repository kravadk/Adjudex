import { Suspense } from "react";
import { LeaderboardClient } from "@/components/app/LeaderboardClient";

export default function LeaderboardPage() {
  return (
    <Suspense>
      <LeaderboardClient />
    </Suspense>
  );
}
