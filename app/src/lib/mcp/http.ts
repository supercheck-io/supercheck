import { NextRequest, NextResponse } from "next/server";
import { isMcpServerEnabled } from "./config";

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

export function mcpJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** The connect and connection endpoints do not exist unless the server is enabled. */
export function guardMcpEnabled(): NextResponse | null {
  return isMcpServerEnabled() ? null : mcpJson({ error: "not_found" }, 404);
}

/** Reads a JSON object body, stopping once it exceeds `max` bytes. */
export async function readJsonBody(
  request: NextRequest,
  max = 16 * 1024,
): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;

  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
