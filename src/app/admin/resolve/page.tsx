import { ManualResolveClient } from "@/components/app/ManualResolveClient";

export const metadata = {
  title: "Manual resolution",
  description: "Admin-only manual market resolution on Adjudex.",
};

export default function AdminResolvePage() {
  return <ManualResolveClient />;
}
