import { Suspense } from "react";
import { EscalatedReviewClient } from "@/components/app/EscalatedReviewClient";

export const metadata = {
  title: "Escalated resolutions · Adjudex",
};

export default function AdminEscalatedPage() {
  return (
    <Suspense>
      <EscalatedReviewClient />
    </Suspense>
  );
}
