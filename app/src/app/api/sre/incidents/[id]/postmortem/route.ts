import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sreIncidents } from "@/db/schema";
import { postmortemToMarkdown } from "@/lib/sre/postmortem-format";
import { db } from "@/utils/db";
import { requireSreApiPermissions } from "../../../_auth";

const idSchema = z.string().uuid();

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSreApiPermissions([{ resource: "sre_incident", action: "view" }]);
  if (!auth.success) return auth.response;

  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) return NextResponse.json({ error: "Invalid incident ID" }, { status: 400 });

  const [incident] = await db
    .select({ incidentNumber: sreIncidents.incidentNumber, title: sreIncidents.title, postmortem: sreIncidents.postmortem })
    .from(sreIncidents)
    .where(and(
      eq(sreIncidents.id, parsedId.data),
      eq(sreIncidents.organizationId, auth.context.organizationId),
      eq(sreIncidents.projectId, auth.context.project.id),
    ))
    .limit(1);

  if (!incident) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  const { postmortem } = incident;
  return NextResponse.json({
    success: true,
    postmortem: postmortem ? { sections: postmortem.sections, generatedAt: postmortem.generatedAt ?? null, updatedAt: postmortem.updatedAt ?? null } : null,
    markdown: postmortem ? postmortemToMarkdown({ incidentNumber: incident.incidentNumber, title: incident.title, sections: postmortem.sections }) : null,
  });
}
