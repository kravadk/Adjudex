import { proxyToBackend } from "@/lib/server/backend-api";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const marketId = encodeURIComponent(decodeURIComponent(id));
  return proxyToBackend(request, `/api/admin/markets/${marketId}/propose`);
}
