import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sreInvestigationRuns } from "@/db/schema";
import { db } from "@/utils/db";
import { requireSreApiPermissions } from "../../_auth";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSreApiPermissions([{ resource: "sre_investigation", action: "view" }]);
  if (!auth.success) return auth.response;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Invalid investigation run ID" }, { status: 400 });
  const [run] = await db.select({
    id: sreInvestigationRuns.id,
    incidentId: sreInvestigationRuns.incidentId,
    agentType: sreInvestigationRuns.agentType,
    status: sreInvestigationRuns.status,
    startedAt: sreInvestigationRuns.startedAt,
    completedAt: sreInvestigationRuns.completedAt,
    durationMs: sreInvestigationRuns.durationMs,
  }).from(sreInvestigationRuns).where(and(
    eq(sreInvestigationRuns.id, id.data),
    eq(sreInvestigationRuns.organizationId, auth.context.organizationId),
    eq(sreInvestigationRuns.projectId, auth.context.project.id),
  )).limit(1);
  if (!run) return NextResponse.json({ error: "Investigation run not found" }, { status: 404 });
  return NextResponse.json({ run });
}
