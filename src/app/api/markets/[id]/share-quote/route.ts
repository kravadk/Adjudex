import { proxyToBackend } from "@/lib/server/backend-api";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params;
  const id = decodeURIComponent(rawId);
  return proxyToBackend(request, `/api/markets/${encodeURIComponent(id)}/share-quote`);
}
