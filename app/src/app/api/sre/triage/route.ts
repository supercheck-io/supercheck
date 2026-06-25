import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { isSreTriageAgentEnabled } from "@/sre/lib/feature-gates";
import { runSreIncidentTriage } from "@/sre/lib/triage-runner";

const triageRequestSchema = z.object({
  incidentId: z.string().uuid(),
});

function authErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Authentication required";
  return NextResponse.json({ error: message }, { status: 401 });
}

async function parseRequestJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!isSreTriageAgentEnabled()) {
    return NextResponse.json({ error: "SRE triage agent is not enabled" }, { status: 404 });
  }

  let context: Awaited<ReturnType<typeof requireProjectContext>>;
  try {
    context = await requireProjectContext();
  } catch (error) {
    return authErrorResponse(error);
  }

  const permissionContext = {
    userId: context.userId,
    organizationId: context.organizationId,
    project: context.project,
  };
  const canInvestigateIncident = checkPermissionWithContext("sre_incident", "investigate", permissionContext);
  const canRunInvestigation = checkPermissionWithContext("sre_investigation", "investigate", permissionContext);

  if (!canInvestigateIncident || !canRunInvestigation) {
    return NextResponse.json({ error: "Insufficient permissions to run SRE triage" }, { status: 403 });
  }

  const parsed = triageRequestSchema.safeParse(await parseRequestJson(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid SRE triage request" }, { status: 400 });
  }

  const result = await runSreIncidentTriage({
    userId: context.userId,
    organizationId: context.organizationId,
    projectId: context.project.id,
    incidentId: parsed.data.incidentId,
  });

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, investigationRunId: result.investigationRunId },
      { status: result.status }
    );
  }

  return NextResponse.json(result);
}
