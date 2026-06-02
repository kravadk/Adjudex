import { proxyToBackend } from "@/lib/server/backend-api";

export async function GET(request: Request) {
  return proxyToBackend(request, "/api/settings");
}

export async function PUT(request: Request) {
  return proxyToBackend(request, "/api/settings");
}
