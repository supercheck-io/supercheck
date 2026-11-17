import { NextRequest } from "next/server";

/** Test requests for the same-origin and body-cap guards on cookie-session write routes. */
export const SAME_ORIGIN = "http://localhost";
export const CROSS_ORIGIN = "https://evil.example";

export function jsonRequest(url: string, method: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${SAME_ORIGIN}${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Declares a Content-Length over the cap; the guard must refuse it without reading. */
export function declaredOversizeRequest(url: string, method: string, bytes: number) {
  return new NextRequest(`${SAME_ORIGIN}${url}`, {
    method,
    body: "{}",
    headers: { "content-type": "application/json", "content-length": String(bytes) },
  });
}

/** Streams `bytes` with no Content-Length, so only a cap enforced on the stream can refuse it. */
export function streamedOversizeRequest(url: string, method: string, bytes: number) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`{"x":"${"a".repeat(bytes)}"}`));
      controller.close();
    },
  });
  const init = { method, body, headers: { "content-type": "application/json" }, duplex: "half" };
  return new NextRequest(new Request(`${SAME_ORIGIN}${url}`, init as RequestInit));
}
