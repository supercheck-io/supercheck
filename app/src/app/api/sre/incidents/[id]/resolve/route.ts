import { and, eq, ne } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sreIncidents, sreIncidentTimelineEvents } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { db } from "@/utils/db";
import { requireSreApiPermissions, requireSreSameOriginRequest } from "../../../_auth";

const bodySchema = z.object({ comment: z.string().trim().min(1).max(2000) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSreSameOriginRequest(request);
  if (originError) return originError;
  const auth = await requireSreApiPermissions([{ resource: "sre_incident", action: "update" }]);
  if (!auth.success) return auth.response;
  const parsedId = z.string().uuid().safeParse((await params).id);
  const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsedBody.success) {
    return NextResponse.json({ error: "A valid incident ID and resolution comment are required" }, { status: 400 });
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx.update(sreIncidents).set({ status: "resolved", resolvedAt: now, updatedAt: now })
      .where(and(
        eq(sreIncidents.id, parsedId.data),
        eq(sreIncidents.organizationId, auth.context.organizationId),
        eq(sreIncidents.projectId, auth.context.project.id),
        ne(sreIncidents.status, "resolved"),
      )).returning({ id: sreIncidents.id, incidentNumber: sreIncidents.incidentNumber, title: sreIncidents.title });
    if (!updated) {
      const [existing] = await tx.select({
        id: sreIncidents.id,
        incidentNumber: sreIncidents.incidentNumber,
        title: sreIncidents.title,
        status: sreIncidents.status,
      }).from(sreIncidents).where(and(
        eq(sreIncidents.id, parsedId.data),
        eq(sreIncidents.organizationId, auth.context.organizationId),
        eq(sreIncidents.projectId, auth.context.project.id),
      )).limit(1);
      return existing?.status === "resolved" ? { incident: existing, changed: false } : null;
    }
    await tx.insert(sreIncidentTimelineEvents).values({
      incidentId: updated.id,
      eventType: "state_change",
      eventData: { state: "resolved", comment: parsedBody.data.comment },
      actorType: "user",
      actorUserId: auth.context.userId,
      createdAt: now,
    });
    return { incident: updated, changed: true };
  });
  if (!result) return NextResponse.json({ error: "Incident not found" }, { status: 404 });

  if (result.changed) {
    await logAuditEvent({
      userId: auth.context.userId,
      organizationId: auth.context.organizationId,
      action: "sre_incident_resolved",
      resource: "sre_incident",
      resourceId: result.incident.id,
      metadata: { projectId: auth.context.project.id, incidentNumber: result.incident.incidentNumber },
      success: true,
    });
  }
  return NextResponse.json({
    success: true,
    incident: result.incident,
    alreadyResolved: !result.changed,
    message: result.changed ? `Incident #${result.incident.incidentNumber} resolved` : `Incident #${result.incident.incidentNumber} was already resolved`,
  });
}
