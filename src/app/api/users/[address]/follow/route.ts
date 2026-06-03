import { proxyToBackend } from "@/lib/server/backend-api";

export async function POST(request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params;
  return proxyToBackend(request, `/api/users/${encodeURIComponent(address)}/follow`);
}

export async function DELETE(request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params;
  return proxyToBackend(request, `/api/users/${encodeURIComponent(address)}/follow`);
}
