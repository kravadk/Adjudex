import { proxyToBackend } from "@/lib/server/backend-api";

export async function GET(request: Request) {
  return proxyToBackend(request, "/api/integrations/sponsors");
}
