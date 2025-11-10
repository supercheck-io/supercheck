import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { tests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { buildContextualMetrics } from "~/lib/observability/analytics";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ testId: string }> }
) {
  const params = await context.params;
  const { testId } = params;
  if (!testId) {
    return NextResponse.json(
      { error: "Test ID is required" },
      { status: 400 }
    );
  }

  try {
    const { project, organizationId } = await requireProjectContext();

    const testRecord = await db
      .select({
        id: tests.id,
        projectId: tests.projectId,
      })
      .from(tests)
      .where(eq(tests.id, testId))
      .limit(1);

    if (!testRecord.length) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }

    if (testRecord[0].projectId !== project.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const searchParams = req.nextUrl.searchParams;
    const start = searchParams.get("start") || undefined;
    const end = searchParams.get("end") || undefined;
    const bucketCount = searchParams.get("buckets")
      ? Number(searchParams.get("buckets"))
      : undefined;

    const metrics = await buildContextualMetrics({
      entity: "test",
      entityId: testId,
      projectId: project.id,
      organizationId,
      start,
      end,
      bucketCount,
    });

    return NextResponse.json(metrics);
  } catch (error) {
    console.error("Failed to load test observability metrics:", error);
    return NextResponse.json(
      { error: "Failed to load metrics" },
      { status: 500 }
    );
  }
}
