import { and, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sreIncidentAlerts, sreIncidents, sreServices } from "@/db/schema";
import { requireSreApiPermissions } from "../_auth";
import { db } from "@/utils/db";

const querySchema = z.object({
  status: z.enum(["triggered", "investigating", "identified", "recommendations_ready", "user_applying_fix", "verifying", "resolved"]).optional(),
  severity: z.enum(["sev1", "sev2", "sev3", "sev4"]).optional(),
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
  if (parsed.data.status) filters.push(eq(sreIncidents.status, parsed.data.status));
  if (parsed.data.severity) filters.push(eq(sreIncidents.severity, parsed.data.severity));

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

  return NextResponse.json({ success: true, incidents });
}
