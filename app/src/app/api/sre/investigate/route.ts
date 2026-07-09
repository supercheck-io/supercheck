import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createLogger } from "@/lib/logger/index";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { assertCanStartSreInvestigation, consumeSreInvestigationCredit, SreInvestigationBillingError } from "@/lib/sre/investigation-billing";
import { isSreInvestigationAgentEnabled } from "@/sre/lib/feature-gates";
import { startSreIncidentInvestigation, executeSreIncidentInvestigation } from "@/sre/lib/investigation-runner";
import { requireSreSameOriginRequest } from "../_auth";

const investigateRequestSchema = z.object({
  incidentId: z.string().uuid(),
  useLiveConnectors: z.boolean().optional().default(false),
});

const investigationLogger = createLogger({ module: "sre-investigate-api" }) as {
  error: (data: unknown, msg?: string) => void;
};

function authErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Authentication required";
  return NextResponse.json({ error: message }, { status: 401 });
}

function featureDisabledResponse() {
  return NextResponse.json(
    {
      error: "SRE investigation is not enabled",
      code: "feature_disabled",
      enabledBy: "SRE_INVESTIGATION_AGENT_ENABLED",
    },
    { status: 503 },
  );
}

async function parseRequestJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!isSreInvestigationAgentEnabled()) {
    return featureDisabledResponse();
  }

  const sameOriginError = requireSreSameOriginRequest(request);
  if (sameOriginError) {
    return sameOriginError;
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
    return NextResponse.json({ error: "Insufficient permissions to run SRE investigation" }, { status: 403 });
  }

  const parsed = investigateRequestSchema.safeParse(await parseRequestJson(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid SRE investigation request" }, { status: 400 });
  }

  try {
    await assertCanStartSreInvestigation(context.organizationId);
  } catch (error) {
    if (error instanceof SreInvestigationBillingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 402 });
    }

    throw error;
  }

  const canInvestigateConnectors = checkPermissionWithContext("sre_connector", "investigate", permissionContext);
  const enableLiveConnectors = parsed.data.useLiveConnectors && canInvestigateConnectors;
  const startResult = await startSreIncidentInvestigation({
    userId: context.userId,
    organizationId: context.organizationId,
    projectId: context.project.id,
    incidentId: parsed.data.incidentId,
    enableLiveConnectors,
  });

  if (!startResult.success) {
    return NextResponse.json(
      { error: startResult.error },
      { status: startResult.status }
    );
  }

  let execResult: Awaited<ReturnType<typeof executeSreIncidentInvestigation>>;
  try {
    execResult = await executeSreIncidentInvestigation(
      startResult.investigationRunId,
      startResult.incident,
      {
        userId: context.userId,
        organizationId: context.organizationId,
        projectId: context.project.id,
        incidentId: parsed.data.incidentId,
        enableLiveConnectors,
      }
    );
  } catch (error) {
    investigationLogger.error(
      {
        err: error,
        organizationId: context.organizationId,
        projectId: context.project.id,
        incidentId: parsed.data.incidentId,
        investigationRunId: startResult.investigationRunId,
      },
      "SRE investigation execution failed before returning run status"
    );
    return NextResponse.json(
      { error: "SRE investigation failed", investigationRunId: startResult.investigationRunId },
      { status: 502 }
    );
  }

  if (!execResult.success) {
    return NextResponse.json(
      { error: execResult.error, investigationRunId: execResult.investigationRunId },
      { status: execResult.status }
    );
  }

  try {
    await consumeSreInvestigationCredit({
      organizationId: context.organizationId,
      projectId: context.project.id,
      userId: context.userId,
      incidentId: parsed.data.incidentId,
      investigationRunId: startResult.investigationRunId,
      useLiveConnectors: enableLiveConnectors,
    });
  } catch (error) {
    investigationLogger.error(
      {
        err: error,
        organizationId: context.organizationId,
        projectId: context.project.id,
        incidentId: parsed.data.incidentId,
        investigationRunId: startResult.investigationRunId,
      },
      "SRE investigation billing consumption failed after successful run"
    );
  }

  return NextResponse.json({
    success: true,
    investigationRunId: startResult.investigationRunId,
    summary: execResult.summary,
  });
}
