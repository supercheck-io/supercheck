import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createLogger } from "@/lib/logger/index";
import { MAX_RESOLUTION_SUMMARY_LENGTH, resolveIncident } from "@/lib/sre/incident-lifecycle";
import { requireSreApiPermissions, requireSreIncidentUpdateRateLimit, requireSreSameOriginRequest } from "../../../_auth";

// `comment` is the original field name and stays accepted; it is stored as the resolution summary.
const bodySchema = z
  .object({
    comment: z.string().trim().min(1).max(MAX_RESOLUTION_SUMMARY_LENGTH).optional(),
    resolutionSummary: z.string().trim().min(1).max(MAX_RESOLUTION_SUMMARY_LENGTH).optional(),
  })
  .refine((body) => body.resolutionSummary ?? body.comment, { message: "A resolution summary is required" });

const logger = createLogger({ module: "sre-incident-lifecycle-api" }) as { error: (data: unknown, message?: string) => void };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSreSameOriginRequest(request);
  if (originError) return originError;
  const auth = await requireSreApiPermissions([{ resource: "sre_incident", action: "update" }]);
  if (!auth.success) return auth.response;
  try {
    const parsedId = z.string().uuid().safeParse((await params).id);
    const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsedId.success || !parsedBody.success) {
      return NextResponse.json({ error: "A valid incident ID and resolution summary are required" }, { status: 400 });
    }
    const limited = await requireSreIncidentUpdateRateLimit(auth.context.userId, parsedId.data);
    if (limited) return limited;

    const result = await resolveIncident(
      { organizationId: auth.context.organizationId, projectId: auth.context.project.id, userId: auth.context.userId },
      parsedId.data,
      (parsedBody.data.resolutionSummary ?? parsedBody.data.comment) as string,
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.code === "not_found" ? 404 : 400 });
    }
    return NextResponse.json({
      success: true,
      incident: result.incident,
      alreadyResolved: !result.changed,
      message: result.changed ? `Incident #${result.incident.incidentNumber} resolved` : `Incident #${result.incident.incidentNumber} was already resolved`,
    });
  } catch (error) {
    logger.error({ error }, "Error updating SRE incident");
    return NextResponse.json({ error: "Failed to update incident" }, { status: 500 });
  }
}
