import { and, asc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sreIncidents, sreIncidentTimelineEvents } from "@/db/schema";
import { db } from "@/utils/db";
import { requireSreApiPermissions } from "../../../_auth";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSreApiPermissions([{ resource: "sre_incident", action: "view" }]);
  if (!auth.success) return auth.response;
  const parsedId = z.string().uuid().safeParse((await params).id);
  if (!parsedId.success) return NextResponse.json({ error: "Invalid incident ID" }, { status: 400 });

  const [incident] = await db.select({ id: sreIncidents.id }).from(sreIncidents).where(and(
    eq(sreIncidents.id, parsedId.data),
    eq(sreIncidents.organizationId, auth.context.organizationId),
    eq(sreIncidents.projectId, auth.context.project.id),
  )).limit(1);
  if (!incident) return NextResponse.json({ error: "Incident not found" }, { status: 404 });

  const events = await db.select().from(sreIncidentTimelineEvents)
    .where(eq(sreIncidentTimelineEvents.incidentId, parsedId.data))
    .orderBy(asc(sreIncidentTimelineEvents.createdAt)).limit(1000);
  return NextResponse.json({ success: true, events });
}
