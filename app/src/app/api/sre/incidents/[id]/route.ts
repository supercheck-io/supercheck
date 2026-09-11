import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sreIncidents, sreServices } from "@/db/schema";
import { db } from "@/utils/db";
import { requireSreApiPermissions } from "../../_auth";

const idSchema = z.string().uuid();

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSreApiPermissions([{ resource: "sre_incident", action: "view" }]);
  if (!auth.success) return auth.response;

  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) return NextResponse.json({ error: "Invalid incident ID" }, { status: 400 });

  const [incident] = await db
    .select({
      id: sreIncidents.id,
      incidentNumber: sreIncidents.incidentNumber,
      title: sreIncidents.title,
      severity: sreIncidents.severity,
      status: sreIncidents.status,
      primaryServiceId: sreIncidents.primaryServiceId,
      primaryServiceName: sreServices.name,
      rootCauseSummary: sreIncidents.rootCauseSummary,
      confidenceScore: sreIncidents.confidenceScore,
      resolvedAt: sreIncidents.resolvedAt,
      verifiedAt: sreIncidents.verifiedAt,
      createdAt: sreIncidents.createdAt,
      updatedAt: sreIncidents.updatedAt,
    })
    .from(sreIncidents)
    .leftJoin(sreServices, eq(sreIncidents.primaryServiceId, sreServices.id))
    .where(and(
      eq(sreIncidents.id, parsedId.data),
      eq(sreIncidents.organizationId, auth.context.organizationId),
      eq(sreIncidents.projectId, auth.context.project.id),
    ))
    .limit(1);

  if (!incident) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  return NextResponse.json({ success: true, incident });
}
