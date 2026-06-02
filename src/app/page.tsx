import { Suspense } from "react";
import { HomeClient } from "@/components/app/HomeClient";

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
