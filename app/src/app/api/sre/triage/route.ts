import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { checkSreTriageRateLimit } from "@/lib/sre/sre-rate-limiter";
import { isSreTriageAgentEnabled } from "@/sre/lib/feature-gates";
import { runSreIncidentTriage } from "@/sre/lib/triage-runner";
import { requireSreSameOriginRequest } from "../_auth";

const triageRequestSchema = z.object({
  incidentId: z.string().uuid(),
});

function authErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Authentication required";
  return NextResponse.json({ error: message }, { status: 401 });
}

function featureDisabledResponse() {
  return NextResponse.json(
    {
      error: "SRE triage is not enabled",
      code: "feature_disabled",
      enabledBy: "SRE_TRIAGE_AGENT_ENABLED",
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

  if (!isSreTriageAgentEnabled()) {
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
    return NextResponse.json({ error: "Insufficient permissions to run SRE triage" }, { status: 403 });
  }

  const parsed = triageRequestSchema.safeParse(await parseRequestJson(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid SRE triage request" }, { status: 400 });
  }

  const rateLimit = await checkSreTriageRateLimit(
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
          ? "Triage rate limiter is temporarily unavailable. Please try again shortly."
          : "Triage rate limit reached. Please wait before starting another run.",
      },
      {
        status: rateLimit.unavailable ? 503 : 429,
        headers: { "Retry-After": String(retryAfter) },
      },
    );
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
