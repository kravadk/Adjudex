import { NextResponse } from "next/server";

export function requireBackendUrl(request?: Request) {
  void request;
  const backendBaseUrl = process.env.BACKEND_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!backendBaseUrl || backendBaseUrl.startsWith("/")) {
    throw new Error("BACKEND_API_URL must point to a real backend API.");
  }
  return backendBaseUrl.replace(/\/$/, "");
}

export async function proxyToBackend(request: Request, path: string) {
  try {
    const sourceUrl = new URL(request.url);
    const target = new URL(`${requireBackendUrl(request)}${path}`);
    target.search = sourceUrl.search;

    const response = await fetch(target, {
      method: request.method,
      headers: forwardHeaders(request.headers),
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
      cache: "no-store",
    });

    // undici (the server-side fetch) transparently decompresses the body, so
    // the stream we forward is already plain bytes. Copying the backend's
    // Content-Encoding/Content-Length verbatim makes the browser try to gunzip
    // an already-decoded body -> ERR_CONTENT_DECODING_FAILED. Strip them.
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.delete("transfer-encoding");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "backend_not_configured",
        message: error instanceof Error ? error.message : "Backend API is unavailable.",
      },
      { status: 503 }
    );
  }
}

function forwardHeaders(headers: Headers) {
  const next = new Headers(headers);
  next.delete("host");
  next.delete("connection");
  return next;
}
