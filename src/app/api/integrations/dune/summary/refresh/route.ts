import { proxyToBackend } from "@/lib/server/backend-api";

export async function POST(request: Request) {
  return proxyToBackend(request, "/api/integrations/dune/summary/refresh");
}
