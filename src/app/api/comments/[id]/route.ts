import { proxyToBackend } from "@/lib/server/backend-api";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToBackend(request, `/api/comments/${encodeURIComponent(id)}`);
}
