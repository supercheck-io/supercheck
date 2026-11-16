import { NextRequest, NextResponse } from "next/server";
import { checkSetupLockRateLimit } from "@/lib/sre/sre-rate-limiter";
import { guardProject } from "@/lib/setup/route-guard";
import { claimLock, releaseLock } from "@/lib/setup/setup-state";
import type { SetupLockResponse } from "@/lib/setup/types";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const guard = await guardProject(request, (await params).id, { resource: "monitor", action: "create" }, checkSetupLockRateLimit);
    if (guard instanceof NextResponse) return guard;
    const result = await claimLock(guard.ctx.organizationId, guard.ctx.project.id, guard.userId);
    if (result.kind === "locked") return NextResponse.json({ error: "locked", lock: result.lock }, { status: 423 });
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
