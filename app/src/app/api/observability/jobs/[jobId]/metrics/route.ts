import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { buildContextualMetrics } from "~/lib/observability/analytics";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params;

  if (!jobId) {
    return NextResponse.json(
      { error: "Job ID is required" },
      { status: 400 }
    );
  }

  try {
    const { project, organizationId } = await requireProjectContext();

    const jobRecord = await db
      .select({
        id: jobs.id,
        projectId: jobs.projectId,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!jobRecord.length) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (jobRecord[0].projectId !== project.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const searchParams = req.nextUrl.searchParams;
    const start = searchParams.get("start") || undefined;
    const end = searchParams.get("end") || undefined;
    const bucketCount = searchParams.get("buckets")
      ? Number(searchParams.get("buckets"))
      : undefined;

    const metrics = await buildContextualMetrics({
      entity: "job",
      entityId: jobId,
      projectId: project.id,
      organizationId,
      start,
      end,
      bucketCount,
    });

    return NextResponse.json(metrics);
  } catch (error) {
    console.error("Failed to load job observability metrics:", error);
    return NextResponse.json(
      { error: "Failed to load metrics" },
      { status: 500 }
    );
  }
}
