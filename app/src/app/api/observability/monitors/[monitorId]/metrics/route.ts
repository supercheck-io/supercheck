import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { monitors } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { buildContextualMetrics } from "~/lib/observability/analytics";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { monitorId: string } }
) {
  const { monitorId } = params;

  if (!monitorId) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 }
    );
  }

  try {
    const { project, organizationId } = await requireProjectContext();

    const monitorRecord = await db
      .select({
        id: monitors.id,
        projectId: monitors.projectId,
      })
      .from(monitors)
      .where(eq(monitors.id, monitorId))
      .limit(1);

    if (!monitorRecord.length) {
      return NextResponse.json(
        { error: "Monitor not found" },
        { status: 404 }
      );
    }

    if (monitorRecord[0].projectId !== project.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const searchParams = req.nextUrl.searchParams;
    const start = searchParams.get("start") || undefined;
    const end = searchParams.get("end") || undefined;
    const bucketCount = searchParams.get("buckets")
      ? Number(searchParams.get("buckets"))
      : undefined;

    const metrics = await buildContextualMetrics({
      entity: "monitor",
      entityId: monitorId,
      projectId: project.id,
      organizationId,
      start,
      end,
      bucketCount,
    });

    return NextResponse.json(metrics);
  } catch (error) {
    console.error("Failed to load monitor observability metrics:", error);
    return NextResponse.json(
      { error: "Failed to load metrics" },
      { status: 500 }
    );
  }
}
