import { AgentProfileClient } from "@/components/app/AgentProfileClient";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentProfileClient id={id} />;
}
