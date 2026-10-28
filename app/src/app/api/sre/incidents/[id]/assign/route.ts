import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createLogger } from "@/lib/logger/index";
import { assignIncident } from "@/lib/sre/incident-lifecycle";
import { requireSreApiPermissions, requireSreIncidentUpdateRateLimit, requireSreSameOriginRequest } from "../../../_auth";

// null unassigns. `role: "commander"` sets the optional incident commander instead of the assignee.
const bodySchema = z.object({
  assigneeUserId: z.string().uuid().nullable(),
  role: z.enum(["assignee", "commander"]).default("assignee"),
});

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
      return NextResponse.json({ error: "A valid incident ID and assigneeUserId (or null) are required" }, { status: 400 });
    }
    const limited = await requireSreIncidentUpdateRateLimit(auth.context.userId, parsedId.data);
    if (limited) return limited;

    const result = await assignIncident(
      { organizationId: auth.context.organizationId, projectId: auth.context.project.id, userId: auth.context.userId },
      parsedId.data,
      parsedBody.data.assigneeUserId,
      parsedBody.data.role,
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.code === "not_found" ? 404 : 400 });
    }
    return NextResponse.json({
      success: true,
      incident: result.incident,
      changed: result.changed,
      message: `Incident #${result.incident.incidentNumber} ${parsedBody.data.assigneeUserId ? "assigned" : "unassigned"}`,
    });
  } catch (error) {
    logger.error({ error }, "Error updating SRE incident");
    return NextResponse.json({ error: "Failed to update incident" }, { status: 500 });
  }
}
