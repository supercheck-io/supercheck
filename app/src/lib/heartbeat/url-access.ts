import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { monitors } from "@/db/schema";
import { liveMonitor } from "@/lib/deletion/visibility";
import { permissionDeniedResponse } from "@/lib/deletion/org-state";
import { authErrorStatus, isAuthError, requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext, isImpersonatedSession } from "@/lib/rbac/middleware";
import { checkMonitorApiRateLimit } from "@/lib/session-security";
import { logAuditEvent } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger/index";
import { isUuid } from "@/lib/uuid";
import { buildHeartbeatPingUrl, createHeartbeatTokenColumns, decryptHeartbeatToken } from "./token";
import { requireSessionSameOrigin } from "@/lib/security/same-origin";

const logger = createLogger({ module: "heartbeat-url" }) as { error: (data: unknown, msg?: string) => void };

const TEN_MINUTES_MS = 10 * 60 * 1000;
const MODES = {
  reveal: { limit: 30, operation: "heartbeat_url_reveal", action: "monitor_heartbeat_url_revealed" },
  rotate: { limit: 10, operation: "heartbeat_url_rotate", action: "monitor_heartbeat_url_rotated" },
} as const;

const NOT_FOUND = () => NextResponse.json({ error: "Monitor not found" }, { status: 404 });

/**
 * GET /api/monitors/[id]/heartbeat-url (reveal) and POST .../rotate. The ping URL is a secret: editors and
 * above only (monitor:update), per-user rate limit, audited without the token, never cached, and refused
 * while a super admin impersonates (the URL would outlive the impersonation, like a revealed secret).
 */
export async function handleHeartbeatUrl(id: string, request: NextRequest, mode: keyof typeof MODES): Promise<NextResponse> {
  const requestOrigin = request.nextUrl.origin;
  const { limit, operation, action } = MODES[mode];
  try {
    const ctx = await requireAuthContext();
    if (mode === "rotate") {
      const originError = requireSessionSameOrigin(request, ctx.isCliAuth);
      if (originError) return originError;
    }
    if (!checkPermissionWithContext("monitor", "update", ctx)) {
      return await permissionDeniedResponse(ctx.organizationId, "Insufficient permissions");
    }
    if (!isUuid(id)) return NOT_FOUND();
    if (!ctx.isCliAuth && (await isImpersonatedSession())) {
      await logAuditEvent({
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        action: "monitor_heartbeat_url_impersonation_blocked",
        resource: "monitor",
        resourceId: id,
        metadata: { projectId: ctx.project.id, mode },
        success: false,
      });
      return NextResponse.json({ error: "The ping URL cannot be revealed while impersonating a user" }, { status: 403 });
    }

    const rate = await checkMonitorApiRateLimit(ctx.userId, ctx.organizationId, operation, limit, TEN_MINUTES_MS);
    if (!rate.allowed) {
      const retryAfter = String(rate.retryAfter ?? 60);
      return NextResponse.json({ error: "Too many requests", retryAfter: Number(retryAfter) }, { status: 429, headers: { "Retry-After": retryAfter } });
    }

    const scope = and(
      eq(monitors.id, id),
      eq(monitors.projectId, ctx.project.id),
      eq(monitors.organizationId, ctx.organizationId),
      eq(monitors.type, "heartbeat"),
      liveMonitor(),
    );
    const [monitor] = await db
      .select({ name: monitors.name, encrypted: monitors.heartbeatTokenEncrypted })
      .from(monitors)
      .where(scope)
      .limit(1);
    if (!monitor) return NOT_FOUND();

    let token: string;
    if (mode === "rotate") {
      // One UPDATE writes the new hash and ciphertext together: the old URL stops matching at once.
      const next = createHeartbeatTokenColumns(ctx.project.id);
      const [rotated] = await db
        .update(monitors)
        .set({ heartbeatTokenHash: next.heartbeatTokenHash, heartbeatTokenEncrypted: next.heartbeatTokenEncrypted, updatedAt: new Date() })
        .where(scope)
        .returning({ id: monitors.id });
      if (!rotated) return NOT_FOUND();
      token = next.token;
    } else {
      // A heartbeat without a stored token can only be fixed by a rotate.
      if (!monitor.encrypted) return NextResponse.json({ error: "No ping URL is stored; rotate it to create one" }, { status: 409 });
      token = decryptHeartbeatToken(monitor.encrypted, ctx.project.id);
    }

    await logAuditEvent({
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      action,
      resource: "monitor",
      resourceId: id,
      metadata: { monitorName: monitor.name, projectId: ctx.project.id, viaCli: ctx.isCliAuth },
      success: true,
    });
    return NextResponse.json(
      { pingUrl: buildHeartbeatPingUrl(token, requestOrigin) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Authentication required" }, { status: authErrorStatus(error) });
    }
    // Never log the error object's context here: it may hold the decrypted token.
    logger.error({ monitorId: id, mode, errorName: error instanceof Error ? error.name : typeof error }, "Heartbeat URL request failed");
    return NextResponse.json({ error: "Failed to load the ping URL" }, { status: 500 });
  }
}
