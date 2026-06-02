import { proxyToBackend } from "@/lib/server/backend-api";

export async function DELETE(request: Request, context: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await context.params;
  return proxyToBackend(request, `/api/watchlist/${encodeURIComponent(marketId)}`);
}
