import { proxyToBackend } from "@/lib/server/backend-api";

export async function GET(request: Request) {
  return proxyToBackend(request, "/api/webhooks");
}

export async function POST(request: Request) {
  return proxyToBackend(request, "/api/webhooks");
}
