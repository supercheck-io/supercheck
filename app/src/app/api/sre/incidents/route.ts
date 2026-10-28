import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sreIncidentAlerts, sreIncidents, sreServices } from "@/db/schema";
import { requireSreApiPermissions } from "../_auth";
import { db } from "@/utils/db";
import { getDisplayStatus } from "@/lib/sre/incident-status-display";

const querySchema = z.object({
  incidentNumber: z.coerce.number().int().positive().max(2147483647).optional(),
  status: z.enum(["open", "triggered", "investigating", "identified", "recommendations_ready", "user_applying_fix", "verifying", "resolved"]).optional(),
  severity: z.enum(["sev1", "sev2", "sev3", "sev4"]).optional(),
  assignee: z.union([z.literal("me"), z.literal("unassigned"), z.string().uuid()]).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireSreApiPermissions([{ resource: "sre_incident", action: "view" }]);
  if (!auth.success) return auth.response;

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid incident filters" }, { status: 400 });
  }

  const filters = [
    eq(sreIncidents.organizationId, auth.context.organizationId),
    eq(sreIncidents.projectId, auth.context.project.id),
  ];
  if (parsed.data.status === "open") filters.push(ne(sreIncidents.status, "resolved"));
  else if (parsed.data.status) filters.push(eq(sreIncidents.status, parsed.data.status));
  if (parsed.data.severity) filters.push(eq(sreIncidents.severity, parsed.data.severity));
  if (parsed.data.assignee === "unassigned") filters.push(isNull(sreIncidents.assigneeUserId));
  else if (parsed.data.assignee === "me") filters.push(eq(sreIncidents.assigneeUserId, auth.context.userId));
  else if (parsed.data.assignee) filters.push(eq(sreIncidents.assigneeUserId, parsed.data.assignee));
  if (parsed.data.incidentNumber) filters.push(eq(sreIncidents.incidentNumber, parsed.data.incidentNumber));

  const incidents = await db
    .select({
      id: sreIncidents.id,
      incidentNumber: sreIncidents.incidentNumber,
      title: sreIncidents.title,
      severity: sreIncidents.severity,
      status: sreIncidents.status,
      primaryServiceId: sreIncidents.primaryServiceId,
      primaryServiceName: sreServices.name,
      alertCount: sql<number>`count(${sreIncidentAlerts.id})::int`,
      assigneeUserId: sreIncidents.assigneeUserId,
      acknowledgedAt: sreIncidents.acknowledgedAt,
      acknowledgedByUserId: sreIncidents.acknowledgedByUserId,
      commanderUserId: sreIncidents.commanderUserId,
      mitigatedAt: sreIncidents.mitigatedAt,
      resolutionSummary: sreIncidents.resolutionSummary,
      rootCauseSummary: sreIncidents.rootCauseSummary,
      confidenceScore: sreIncidents.confidenceScore,
      resolvedAt: sreIncidents.resolvedAt,
      createdAt: sreIncidents.createdAt,
      updatedAt: sreIncidents.updatedAt,
    })
    .from(sreIncidents)
    .leftJoin(sreServices, eq(sreIncidents.primaryServiceId, sreServices.id))
    .leftJoin(sreIncidentAlerts, eq(sreIncidentAlerts.incidentId, sreIncidents.id))
    .where(and(...filters))
    .groupBy(sreIncidents.id, sreServices.name)
    .orderBy(desc(sreIncidents.updatedAt))
    .limit(500);

  return NextResponse.json({
    success: true,
    // statusLabel is the user-facing status (six values); status stays the stored value.
    incidents: incidents.map((incident) => ({
      ...incident,
      statusLabel: getDisplayStatus(incident.status, incident.acknowledgedAt).label,
    })),
  });
}
