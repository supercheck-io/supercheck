import { NextRequest, NextResponse } from "next/server";
import { checkSetupLockRateLimit } from "@/lib/sre/sre-rate-limiter";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { guardProject, readJsonBody } from "@/lib/setup/route-guard";
import { claimLock, getSetupState, releaseLock } from "@/lib/setup/setup-state";
import { isUuid } from "@/lib/uuid";
import type { SetupLockResponse } from "@/lib/setup/types";

type Params = { params: Promise<{ id: string }> };

/** The per-tab token: a uuid, null when absent, false when malformed. */
function tokenOf(body: { lockToken?: unknown }): string | null | false {
  if (body.lockToken === undefined) return null;
  return typeof body.lockToken === "string" && isUuid(body.lockToken) ? body.lockToken : false;
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const guard = await guardProject(request, (await params).id, { resource: "monitor", action: "create" }, checkSetupLockRateLimit);
    if (guard instanceof NextResponse) return guard;
    const raw = await readJsonBody(request);
    if (raw instanceof NextResponse) return raw;
    const body = (raw.body ?? {}) as { takeover?: unknown; lockToken?: unknown };
    const takeover = body.takeover === true;
    const lockToken = tokenOf(body);
    if (lockToken === false) return NextResponse.json({ error: "Invalid lock token" }, { status: 400 });
    const { ctx, userId } = guard;
    // Without this a single editor can hold the lock forever by heartbeating.
    if (takeover && !checkPermissionWithContext("project", "update", ctx)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const previous = takeover ? (await getSetupState(ctx.organizationId, ctx.project.id, userId)).lock : null;
    const result = await claimLock(ctx.organizationId, ctx.project.id, userId, lockToken, takeover);
    if (result.kind === "locked") return NextResponse.json({ error: "locked", lock: result.lock }, { status: 423 });
    if (takeover && previous && !previous.mine) {
      await logAuditEvent({
        userId,
        organizationId: ctx.organizationId,
        action: "project_setup.lock_taken_over",
        resource: "project_setup",
        resourceId: ctx.project.id,
        metadata: { previousHolderId: previous.userId },
        success: true,
      });
    }
    const response: SetupLockResponse = { lock: result.lock };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Error taking project setup lock:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const guard = await guardProject(request, (await params).id, { resource: "monitor", action: "create" }, checkSetupLockRateLimit);
    if (guard instanceof NextResponse) return guard;
    // The body is optional: a bodiless DELETE only releases a lock stored without a tab token.
    const raw = await readJsonBody(request);
    if (raw instanceof NextResponse) return raw;
    const lockToken = tokenOf((raw.body ?? {}) as { lockToken?: unknown });
    if (lockToken === false) return NextResponse.json({ error: "Invalid lock token" }, { status: 400 });
    await releaseLock(guard.ctx.organizationId, guard.ctx.project.id, guard.userId, lockToken);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error releasing project setup lock:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
