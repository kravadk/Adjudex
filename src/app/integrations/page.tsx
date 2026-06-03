import { Suspense } from "react";
import { SponsorIntegrationsClient } from "@/components/app/SponsorIntegrationsClient";

export default function IntegrationsPage() {
  return (
    <Suspense>
      <SponsorIntegrationsClient />
    </Suspense>
  );
}
