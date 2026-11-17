import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logAuditEvent } from "@/lib/audit-logger";
import { readCappedJson } from "@/lib/http/read-capped-json";
import { ExecutionQueueError } from "@/lib/execution-errors";
import { validateMonitorTargetAddress } from "@/lib/monitor-target-policy";
import { SubscriptionAccessDeniedError, subscriptionService } from "@/lib/services/subscription-service";
import { checkSetupReadRateLimit, checkSetupWriteRateLimit, checkSlidingWindowRateLimit } from "@/lib/sre/sre-rate-limiter";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { stripUrl } from "@/lib/setup/draft-schema";
import { guardProject, rateLimitResponse } from "@/lib/setup/route-guard";
import { enqueueScan, readScan, scanIdPrefix } from "@/lib/setup/scan";
import { saveScanResult } from "@/lib/setup/setup-state";

type Params = { params: Promise<{ id: string }> };

const MAX_SCAN_BODY_BYTES = 8 * 1024;
const HOUR_MS = 60 * 60 * 1000;
const bodySchema = z.object({ url: z.string().min(1).max(2048) }).strict();

const queueUnavailable = () => NextResponse.json({ error: "Scanning is temporarily unavailable" }, { status: 503 });

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const guard = await guardProject(request, (await params).id, { resource: "monitor", action: "create" }, checkSetupWriteRateLimit);
    if (guard instanceof NextResponse) return guard;
    const { userId, ctx } = guard;
    const projectId = ctx.project.id;

    // Capped on the declared length and on the stream, so an oversized body is never read into memory.
    const read = await readCappedJson(request, MAX_SCAN_BODY_BYTES);
    if (read.tooLarge) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    // readCappedJson gives undefined for an empty body and null for an unparseable one.
    if (read.data == null) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    const parsed = bodySchema.safeParse(read.data);
    const target = parsed.success ? stripUrl(parsed.data.url) : null;
    if (!target) return NextResponse.json({ error: "A valid http(s) URL is required" }, { status: 400 });

    // The worker re-vets every address it connects to; this only turns the obvious cases into an early 400.
    const policy = await validateMonitorTargetAddress({ type: "website", target });
    if (!policy.success) {
      return NextResponse.json({ error: policy.error, details: policy.details }, { status: 400 });
    }

    await subscriptionService.blockUntilSubscribed(ctx.organizationId);

    // A slot is spent only by a request that will run.
    const limited =
      rateLimitResponse(await checkSlidingWindowRateLimit(`setup-scan:project:${projectId}`, 10, HOUR_MS)) ??
      rateLimitResponse(await checkSlidingWindowRateLimit(`setup-scan:org:${ctx.organizationId}`, 30, HOUR_MS));
    if (limited) return limited;

    const scanId = await enqueueScan(projectId, target);
    await logAuditEvent({
      userId,
      organizationId: ctx.organizationId,
      action: "project_setup.scanned",
      resource: "project_setup",
      resourceId: projectId,
      metadata: { host: new URL(target).host },
      success: true,
    });
    return NextResponse.json({ scanId }, { status: 202 });
  } catch (error) {
    if (error instanceof SubscriptionAccessDeniedError) {
      return NextResponse.json({ error: error.message, code: error.reason }, { status: 402 });
    }
    if (error instanceof ExecutionQueueError) return queueUnavailable();
    console.error("Error starting setup scan:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const guard = await guardProject(request, (await params).id, { resource: "project", action: "view" }, checkSetupReadRateLimit);
    if (guard instanceof NextResponse) return guard;
    const { ctx } = guard;
    const projectId = ctx.project.id;

    // Job ids are shared by every project: only this project's ids may be read.
    const scanId = request.nextUrl.searchParams.get("scanId") ?? "";
    if (!scanId.startsWith(scanIdPrefix(projectId)) || scanId.length > 120) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }
    const scan = await readScan(scanId);
    if (!scan) return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    // Only a caller who could have started the scan stores it, and a failed scan never replaces a good one.
    const canScan = checkPermissionWithContext("monitor", "create", ctx);
    if (scan.status === "done" && canScan && scan.result.reachable && !scan.result.error) await saveScanResult(ctx.organizationId, projectId, scan.result, scan.scannedAt);
    return NextResponse.json(scan);
  } catch (error) {
    if (error instanceof ExecutionQueueError) return queueUnavailable();
    console.error("Error reading setup scan:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
