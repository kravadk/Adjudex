import { proxyToBackend } from "@/lib/server/backend-api";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return proxyToBackend(request, `/api/import/candidates/${encodeURIComponent(id)}/deploy`);
}
