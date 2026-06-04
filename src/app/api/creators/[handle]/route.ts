import { proxyToBackend } from "@/lib/server/backend-api";

export async function GET(request: Request, context: { params: Promise<{ handle: string }> }) {
  const { handle } = await context.params;
  return proxyToBackend(request, `/api/creators/${encodeURIComponent(handle)}`);
}
