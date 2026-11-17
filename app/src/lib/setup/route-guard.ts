import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, resolveProjectPermissionContext, checkPermissionWithContext, type ProjectPermissionContext } from "@/lib/rbac/middleware";
import { permissionDeniedResponse } from "@/lib/deletion/org-state";
import { isUuid } from "@/lib/uuid";
import { readCappedJson } from "@/lib/http/read-capped-json";
import { requireSessionSameOrigin } from "@/lib/security/same-origin";
import type { SreRateLimitResult } from "@/lib/sre/sre-rate-limiter";

/** Setup routes are session-cookie only (spec D1): any bearer credential is refused before anything else. */
export function rejectBearer(request: NextRequest): NextResponse | null {
  if (request.headers.get("authorization")?.toLowerCase().startsWith("bearer")) {
    return NextResponse.json({ error: "Session authentication required" }, { status: 401 });
  }
  return null;
}

export async function sessionUserId(): Promise<string | NextResponse> {
  try {
    return (await requireAuth()).userId;
  } catch {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
}

export function rateLimitResponse(result: SreRateLimitResult): NextResponse | null {
  if (result.allowed) return null;
  if (result.unavailable) {
    return NextResponse.json({ error: "Rate limiter temporarily unavailable. Try again shortly." }, { status: 503, headers: { "Retry-After": "60" } });
  }
  const retryAfter = result.resetTime ? Math.max(1, Math.ceil((result.resetTime - Date.now()) / 1000)) : 60;
  return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
}

export const MAX_BODY_BYTES = 64 * 1024;

/** Reads a JSON body under the 64 KB cap; returns a response on failure. */
export async function readJsonBody(request: NextRequest): Promise<{ body: unknown } | NextResponse> {
  const read = await readCappedJson(request, MAX_BODY_BYTES);
  if (read.tooLarge) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  if (read.data === null) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  return { body: read.data ?? {} };
}

/** Auth + path project + one permission. Returns the context or the response to send. */
export async function guardProject(
  request: NextRequest,
  rawId: string,
  permission: { resource: Parameters<typeof checkPermissionWithContext>[0]; action: string },
  rateLimit: (userId: string) => Promise<SreRateLimitResult>,
): Promise<{ userId: string; ctx: ProjectPermissionContext } | NextResponse> {
  const bearer = rejectBearer(request);
  if (bearer) return bearer;
  if (request.method !== "GET") {
    const originError = requireSessionSameOrigin(request);
    if (originError) return originError;
  }
  const userId = await sessionUserId();
  if (userId instanceof NextResponse) return userId;
  if (!isUuid(rawId)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const ctx = await resolveProjectPermissionContext(userId, rawId);
  if (!ctx) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!checkPermissionWithContext(permission.resource, permission.action, ctx)) {
    return permissionDeniedResponse(ctx.organizationId, "Insufficient permissions");
  }
  const limited = rateLimitResponse(await rateLimit(userId));
  if (limited) return limited;
  return { userId, ctx };
}
