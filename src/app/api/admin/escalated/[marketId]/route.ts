import { proxyToBackend } from "@/lib/server/backend-api";

export async function POST(
  request: Request,
  context: { params: Promise<{ marketId: string }> },
) {
  const { marketId } = await context.params;
  const id = decodeURIComponent(marketId);
  return proxyToBackend(request, `/api/admin/escalated/${encodeURIComponent(id)}`);
}
