import { proxyToBackend } from "@/lib/server/backend-api";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const marketId = encodeURIComponent(decodeURIComponent(id));
  return proxyToBackend(request, `/api/markets/${marketId}/assertion`);
}
