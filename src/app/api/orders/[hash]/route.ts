import { proxyToBackend } from "@/lib/server/backend-api";

export async function DELETE(request: Request, context: { params: Promise<{ hash: string }> }) {
  const { hash } = await context.params;
  return proxyToBackend(request, `/api/orders/${encodeURIComponent(hash)}`);
}
