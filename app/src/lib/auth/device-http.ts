import { NextRequest, NextResponse } from "next/server";
import { isDeviceAuthEnabled } from "@/lib/auth/device-authorization";

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

export function deviceJson(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...extraHeaders },
  });
}

export function deviceAuthDisabledResponse() {
  return deviceJson(
    {
      error: "device_auth_disabled",
      error_description:
        "Browser login is not enabled on this server. Use `supercheck login --token` instead.",
    },
    503,
  );
}

export function guardDeviceAuthEnabled(): NextResponse | null {
  return isDeviceAuthEnabled() ? null : deviceAuthDisabledResponse();
}

/** Reads the body but stops (and rejects) once it exceeds `max` bytes. */
async function readCapped(request: NextRequest, max: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
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
  return Buffer.concat(chunks).toString("utf8");
}

/** Accepts RFC form encoding (primary) and JSON (convenience); bounded size. */
export async function readDeviceBody(
  request: NextRequest,
): Promise<Record<string, string> | null> {
  const contentType = request.headers.get("content-type") ?? "";
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 4096) return null;
  try {
    const text = await readCapped(request, 4096);
    if (text === null) return null;
    const out: Record<string, string> = {};
    if (contentType.includes("application/json")) {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
    for (const [k, v] of new URLSearchParams(text)) out[k] = v;
    return out;
  } catch {
    return null;
  }
}

/** Canonical public base URL; never derived from attacker-controlled headers when configured. */
export function deviceBaseUrl(request: NextRequest): string {
  const configured =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL;
  try {
    if (configured) return new URL(configured).origin;
  } catch {
    // fall through
  }
  return request.nextUrl.origin;
}
