import { NextResponse } from "next/server";

import { permissionDeniedResponse } from "@/lib/deletion/org-state";
import type { WindowResult } from "@/lib/maintenance/windows";
import { readJsonBody } from "@/lib/http/read-capped-json";

/** One mapping from a window result to an HTTP response, shared by every maintenance route. */
export async function windowResponse<T extends object>(organizationId: string, result: WindowResult<T>, status = 200) {
  if (result.ok) {
    const { ok: _ok, ...body } = result as { ok: true } & T;
    return NextResponse.json({ success: true, ...body }, { status });
  }
  if (result.code === "forbidden") return permissionDeniedResponse(organizationId, result.error);
  if (result.code === "rate_limited") {
    return NextResponse.json({ error: result.error }, { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } });
  }
  if (result.code === "subscription_required") return NextResponse.json({ error: result.error, code: result.code }, { status: 402 });
  const code = { invalid: 400, not_found: 404, conflict: 409 }[result.code];
  return NextResponse.json({ error: result.error, ...("fieldErrors" in result && result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}) }, { status: code });
}

// Up to 500 monitor and 500 service ids plus status-page components fit well inside this.
const MAX_BODY_BYTES = 256 * 1024;

export async function readJson(request: Request): Promise<{ body: unknown } | { response: NextResponse }> {
  const read = await readJsonBody(request, MAX_BODY_BYTES);
  return read instanceof NextResponse ? { response: read } : read;
}

export const clientSource = (request: Request) => (request.headers.get("user-agent")?.startsWith("supercheck-cli/") ? "cli" : "api");
