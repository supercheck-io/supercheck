import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createLogger } from "@/lib/logger/index";
import { acknowledgeIncident } from "@/lib/sre/incident-lifecycle";
import { requireSreApiPermissions, requireSreIncidentUpdateRateLimit, requireSreSameOriginRequest } from "../../../_auth";

const logger = createLogger({ module: "sre-incident-lifecycle-api" }) as { error: (data: unknown, message?: string) => void };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSreSameOriginRequest(request);
  if (originError) return originError;
  const auth = await requireSreApiPermissions([{ resource: "sre_incident", action: "update" }]);
  if (!auth.success) return auth.response;
  try {
    const parsedId = z.string().uuid().safeParse((await params).id);
    if (!parsedId.success) return NextResponse.json({ error: "Invalid incident ID" }, { status: 400 });
    const limited = await requireSreIncidentUpdateRateLimit(auth.context.userId, parsedId.data);
    if (limited) return limited;

    const result = await acknowledgeIncident(
      { organizationId: auth.context.organizationId, projectId: auth.context.project.id, userId: auth.context.userId },
      parsedId.data,
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.code === "not_found" ? 404 : result.code === "conflict" ? 409 : 400 });
    }
    return NextResponse.json({
      success: true,
      incident: result.incident,
      alreadyAcknowledged: !result.changed,
      message: result.changed ? `Incident #${result.incident.incidentNumber} acknowledged` : `Incident #${result.incident.incidentNumber} was already acknowledged`,
    });
  } catch (error) {
    logger.error({ error }, "Error updating SRE incident");
    return NextResponse.json({ error: "Failed to update incident" }, { status: 500 });
  }
}
