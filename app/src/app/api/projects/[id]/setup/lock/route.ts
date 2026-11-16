import { NextRequest, NextResponse } from "next/server";
import { checkSetupLockRateLimit } from "@/lib/sre/sre-rate-limiter";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { guardProject, readJsonBody } from "@/lib/setup/route-guard";
import { claimLock, getSetupState, releaseLock } from "@/lib/setup/setup-state";
import type { SetupLockResponse } from "@/lib/setup/types";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const guard = await guardProject(request, (await params).id, { resource: "monitor", action: "create" }, checkSetupLockRateLimit);
    if (guard instanceof NextResponse) return guard;
    const raw = await readJsonBody(request);
    if (raw instanceof NextResponse) return raw;
    const takeover = (raw.body as { takeover?: unknown } | null)?.takeover === true;
    const { ctx, userId } = guard;
    // Without this a single editor can hold the lock forever by heartbeating.
    if (takeover && !checkPermissionWithContext("project", "update", ctx)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const previous = takeover ? (await getSetupState(ctx.organizationId, ctx.project.id, userId)).lock : null;
    const result = await claimLock(ctx.organizationId, ctx.project.id, userId, takeover);
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
    const body: SetupLockResponse = { lock: result.lock };
    return NextResponse.json(body);
  } catch (error) {
    console.error("Error taking project setup lock:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const guard = await guardProject(request, (await params).id, { resource: "monitor", action: "create" }, checkSetupLockRateLimit);
    if (guard instanceof NextResponse) return guard;
    await releaseLock(guard.ctx.organizationId, guard.ctx.project.id, guard.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error releasing project setup lock:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
