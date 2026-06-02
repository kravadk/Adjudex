import { proxyToBackend } from "@/lib/server/backend-api";

export async function GET(request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params;
  return proxyToBackend(request, `/api/portfolio/${encodeURIComponent(address)}/history`);
}
