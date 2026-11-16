import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/utils/db";
import { eq } from "drizzle-orm";
import { projects } from "@/db/schema";
import { PROJECT_SETUP_STATUSES } from "@/db/schema/project-setup";
import { checkPermissionWithContext, type ProjectPermissionContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { isAIProviderConfigured } from "@/lib/ai/ai-provider";
import { checkSetupReadRateLimit, checkSetupWriteRateLimit } from "@/lib/sre/sre-rate-limiter";
import { deriveChecklist } from "@/lib/setup/checklist";
import { resolveSetupFeatures } from "@/lib/setup/features";
import { SETUP_STEP_KEYS } from "@/lib/setup/persona";
import { guardProject, readJsonBody } from "@/lib/setup/route-guard";
import { getChecklistCounts, getSetupState, monitorsRemaining, updateSetupState } from "@/lib/setup/setup-state";
import type { SetupPermissions, SetupResponse, SetupStateDto } from "@/lib/setup/types";

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
  const [state, counts, remaining, [project]] = await Promise.all([
    knownState ?? getSetupState(ctx.organizationId, projectId, userId),
    getChecklistCounts(ctx.organizationId, projectId),
    monitorsRemaining(ctx.organizationId),
    db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1),
  ]);
  const features = resolveSetupFeatures({ aiConfigured: isAIProviderConfigured() });
  const can = (resource: Parameters<typeof checkPermissionWithContext>[0], action: string) =>
    checkPermissionWithContext(resource, action, ctx);
  const permissions: SetupPermissions = {
    canEdit: can("monitor", "create"),
    canUpdateProject: can("project", "update"),
    canConfigureConnectors: can("sre_connector", "configure"),
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
  };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const guard = await guardProject(request, (await params).id, { resource: "project", action: "view" }, checkSetupReadRateLimit);
    if (guard instanceof NextResponse) return guard;
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
