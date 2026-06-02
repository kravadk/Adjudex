import { proxyToBackend } from "@/lib/server/backend-api";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToBackend(request, `/api/agents/${encodeURIComponent(id)}`);
}
