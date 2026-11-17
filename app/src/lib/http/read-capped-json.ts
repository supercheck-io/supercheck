import { NextResponse } from "next/server";

/** Reads a JSON body while enforcing the cap on the stream, so chunked bodies cannot skip Content-Length. */
export async function readCappedJson(
  request: Request,
  maxBytes: number,
): Promise<{ tooLarge: true } | { tooLarge: false; data: unknown }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true };

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  // An empty body is `undefined` (callers may default it); unparseable JSON is `null`.
  if (received === 0) return { tooLarge: false, data: undefined };
  try {
    return { tooLarge: false, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { tooLarge: false, data: null };
  }
}

/**
 * `readCappedJson` for route handlers: the parsed body, or the 413 / 400 response to return as is.
 * `body` is `any` like `Request.json()`, so it drops in where that was used.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<{ body: any } | NextResponse> {
  const read = await readCappedJson(request, maxBytes);
  if (read.tooLarge) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  if (read.data == null) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  return { body: read.data };
}
