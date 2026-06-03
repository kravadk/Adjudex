import { proxyToBackend } from "@/lib/server/backend-api";

export async function POST(request: Request) {
  const url = new URL(request.url);
  return proxyToBackend(request, `/api/import/gmx/scan${url.search}`);
}
