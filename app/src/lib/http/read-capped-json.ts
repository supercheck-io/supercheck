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
  try {
    return { tooLarge: false, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { tooLarge: false, data: null };
  }
}
