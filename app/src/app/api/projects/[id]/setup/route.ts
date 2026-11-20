import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/utils/db";
import { eq } from "drizzle-orm";
import { projects } from "@/db/schema";
import { PROJECT_SETUP_STATUSES } from "@/db/schema/project-setup";
import { checkPermissionWithContext, type ProjectPermissionContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { SubscriptionAccessDeniedError, subscriptionService } from "@/lib/services/subscription-service";
import { isAIProviderConfigured } from "@/lib/ai/ai-provider";
import { checkSetupReadRateLimit, checkSetupWriteRateLimit } from "@/lib/sre/sre-rate-limiter";
import { deriveChecklist } from "@/lib/setup/checklist";
import { resolveSetupFeatures } from "@/lib/setup/features";
import { SETUP_STEP_KEYS } from "@/lib/setup/persona";
import { guardProject, readJsonBody } from "@/lib/setup/route-guard";
import { getSetupSummary, projectIsEmpty } from "@/lib/setup/summary";
import { getChecklistCounts, getSetupState, monitorsRemaining, updateSetupState } from "@/lib/setup/setup-state";
import { trialCheckIntervalViolation } from "@/lib/execution/trial-limits";
import type { SetupPermissions, SetupResponse, SetupStateDto } from "@/lib/setup/types";
import type { SetupCounts } from "@/lib/setup/checklist";

type Params = { params: Promise<{ id: string }> };

const stepKey = z.enum(SETUP_STEP_KEYS);
const updateSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime().nullable().optional(),
    lockToken: z.string().uuid().optional(),
    status: z.enum(PROJECT_SETUP_STATUSES).optional(),
    currentStep: stepKey.nullable().optional(),
    draft: z.unknown().optional(), // strict allowlist applied by parseSetupDraft in the state layer
    skipped: z.array(stepKey).max(SETUP_STEP_KEYS.length).optional(),
    statusPageOptOut: z.boolean().optional(),
  })
  .strict();

async function buildResponse(userId: string, ctx: ProjectPermissionContext, knownState?: SetupStateDto): Promise<SetupResponse> {
  const projectId = ctx.project.id;
  const [state, counts, remaining, trialViolation, [project]] = await Promise.all([
    knownState ?? getSetupState(ctx.organizationId, projectId, userId),
    getChecklistCounts(ctx.organizationId, projectId),
    monitorsRemaining(ctx.organizationId),
    // Asks for the shortest interval: a trial answers with its minimum, everyone else with null (1 minute).
    trialCheckIntervalViolation(ctx.organizationId, 1),
    db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1),
  ]);
  // Same gate as suggest-requirements: a trial (not paid) org is locked; self-hosted never is. Only a full read
  // looks it up (a write passes its known state and the client keeps the value it had). A failed lookup is
  // unknown (null), not locked: suggest-requirements enforces the plan itself.
  const aiTestsLocked = knownState
    ? null
    : await subscriptionService.blockUntilSubscribed(ctx.organizationId, { allowTrial: false }).then(
        () => false,
        (error) => (error instanceof SubscriptionAccessDeniedError ? true : null),
      );
  const features = resolveSetupFeatures({ aiConfigured: isAIProviderConfigured() });
  const can = (resource: Parameters<typeof checkPermissionWithContext>[0], action: string) =>
    checkPermissionWithContext(resource, action, ctx);
  const permissions: SetupPermissions = {
    canEdit: can("monitor", "create"),
    canUpdateProject: can("project", "update"),
    canConfigureConnectors: can("sre_connector", "configure"),
    canCreateServices: can("sre_service", "create"),
    canInvite: can("invitation", "create"),
    canCreateTests: can("test", "create"),
    canCreateStatusPage: can("status_page", "create"),
    canCreateNotification: can("notification", "create"),
  };
  return {
    projectId,
    projectName: project?.name ?? "",
    state,
    checklist: deriveChecklist(counts, features, state.statusPageOptOut),
    features,
    permissions,
    monitorsRemaining: remaining,
    aiTestsLocked,
    minIntervalMinutes: trialViolation?.minimumMinutes ?? 1,
    projectEmpty: projectIsEmpty(counts),
  };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const guard = await guardProject(request, (await params).id, { resource: "project", action: "view" }, checkSetupReadRateLimit);
    if (guard instanceof NextResponse) return guard;
    if (request.nextUrl.searchParams.get("summary") === "1") {
      // Sidebar poll: state and counts only, no plan lookup, permissions or project name.
      return NextResponse.json(await getSetupSummary(guard.ctx.organizationId, guard.ctx.project.id, guard.userId));
    }
    return NextResponse.json(await buildResponse(guard.userId, guard.ctx));
  } catch (error) {
    console.error("Error reading project setup:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const guard = await guardProject(request, (await params).id, { resource: "monitor", action: "create" }, checkSetupWriteRateLimit);
    if (guard instanceof NextResponse) return guard;
    const { userId, ctx } = guard;
    const projectId = ctx.project.id;

    const raw = await readJsonBody(request);
    if (raw instanceof NextResponse) return raw;
    const parsed = updateSchema.safeParse(raw.body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.issues.map((i) => i.message) }, { status: 400 });
    }
    const { expectedUpdatedAt, lockToken, ...patch } = parsed.data;

    const result = await updateSetupState(ctx.organizationId, projectId, userId, patch as Parameters<typeof updateSetupState>[3], expectedUpdatedAt, lockToken ?? null);
    switch (result.kind) {
      case "invalid":
        return NextResponse.json({ error: "Invalid draft", details: [result.error] }, { status: 400 });
      case "conflict":
        return NextResponse.json({ error: "conflict", state: result.state }, { status: 409 });
      case "locked":
        return NextResponse.json({ error: "locked", lock: result.lock }, { status: 423 });
    }

    if (patch.status && patch.status !== result.previousStatus) {
      // Metadata is the status transition only: never draft content.
      await logAuditEvent({
        userId,
        organizationId: ctx.organizationId,
        action: patch.status === "dismissed" ? "project_setup.dismissed" : "project_setup.updated",
        resource: "project_setup",
        resourceId: projectId,
        metadata: { from: result.previousStatus, to: patch.status },
        success: true,
      });
    }
    return NextResponse.json(await buildResponse(userId, ctx, result.state));
  } catch (error) {
    console.error("Error saving project setup:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
