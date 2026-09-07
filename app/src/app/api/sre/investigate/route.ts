import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createLogger } from "@/lib/logger/index";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { assertCanStartSreInvestigation, SreInvestigationBillingError } from "@/lib/sre/investigation-billing";
import { checkSreInvestigationRateLimit } from "@/lib/sre/sre-rate-limiter";
import { isSreInvestigationAgentEnabled } from "@/sre/lib/feature-gates";
import { completeSreIncidentInvestigation, startSreIncidentInvestigation } from "@/sre/lib/investigation-runner";
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
  const sameOriginError = requireSreSameOriginRequest(request);
  if (sameOriginError) {
    return sameOriginError;
  }

  if (!isSreInvestigationAgentEnabled()) {
    return featureDisabledResponse();
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

  const rateLimit = await checkSreInvestigationRateLimit(
    context.userId,
    parsed.data.incidentId,
  );
  if (!rateLimit.allowed) {
    const retryAfter = rateLimit.resetTime
      ? Math.max(1, Math.ceil((rateLimit.resetTime - Date.now()) / 1000))
      : 300;
    return NextResponse.json(
      {
        error: rateLimit.unavailable
          ? "Investigation rate limiter is temporarily unavailable. Please try again shortly."
          : "Investigation rate limit reached. Please wait before starting another run.",
      },
      {
        status: rateLimit.unavailable ? 503 : 429,
        headers: { "Retry-After": String(retryAfter) },
      },
    );
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

  const executionInput = {
    userId: context.userId,
    organizationId: context.organizationId,
    projectId: context.project.id,
    incidentId: parsed.data.incidentId,
    enableLiveConnectors,
  };

  // Return before the 90s agent budget so Cloudflare/proxy timeouts cannot
  // convert an accepted run into a false HTTP 502. Billing still settles
  // only after a successful completion.
  after(() =>
    completeSreIncidentInvestigation(
      startResult.investigationRunId,
      startResult.incident,
      executionInput,
    ).catch((error) => {
      investigationLogger.error(
        {
          err: error,
          organizationId: context.organizationId,
          projectId: context.project.id,
          incidentId: parsed.data.incidentId,
          investigationRunId: startResult.investigationRunId,
        },
        "SRE investigation execution failed after the run was accepted",
      );
    }),
  );

  return NextResponse.json(
    {
      success: true,
      accepted: true,
      investigationRunId: startResult.investigationRunId,
    },
    { status: 202 },
  );
}
