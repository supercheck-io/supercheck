import { NextRequest, NextResponse } from "next/server";
import { updateJob } from "@/actions/update-job";
import { db } from "@/utils/db";
import { jobs, jobTests, tests as testsTable, testTags, tags } from "@/db/schema";
import { eq, inArray, asc, and } from "drizzle-orm";
import { requireAuthContext, isAuthError } from '@/lib/auth-context';
import { checkPermissionWithContext } from '@/lib/rbac/middleware';

export async function GET(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
) {
  const params = await routeContext.params;
  try {
    const context = await requireAuthContext();
    const jobId = params.id;

    const canView = checkPermissionWithContext("job", "view", context);
    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    
    // Find the job scoped to the current project
    const jobResult = await db
      .select({
        id: jobs.id,
        name: jobs.name,
        description: jobs.description,
        cronSchedule: jobs.cronSchedule,
        status: jobs.status,
        alertConfig: jobs.alertConfig,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        organizationId: jobs.organizationId,
        projectId: jobs.projectId,
        createdByUserId: jobs.createdByUserId,
        lastRunAt: jobs.lastRunAt,
        nextRunAt: jobs.nextRunAt,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.projectId, context.project.id),
          eq(jobs.organizationId, context.organizationId)
        )
      )
      .limit(1);

    if (jobResult.length === 0) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 }
      );
    }

    const job = jobResult[0];
    
    // Get associated tests for this job, ordered by execution sequence
    const testsResult = await db
      .select({
        id: testsTable.id,
        title: testsTable.title,
        description: testsTable.description,
        type: testsTable.type,
        priority: testsTable.priority,
        script: testsTable.script,
        createdAt: testsTable.createdAt,
        updatedAt: testsTable.updatedAt,
        orderPosition: jobTests.orderPosition,
      })
      .from(testsTable)
      .innerJoin(jobTests, eq(testsTable.id, jobTests.testId))
      .where(eq(jobTests.jobId, jobId))
      .orderBy(asc(jobTests.orderPosition));

    // Get tags for all tests in this job
    const testIds = testsResult.map(test => test.id);
    const testTagsForJob = testIds.length > 0 ? await db
      .select({
        testId: testTags.testId,
        tagId: tags.id,
        tagName: tags.name,
        tagColor: tags.color,
      })
      .from(testTags)
      .innerJoin(tags, eq(testTags.tagId, tags.id))
      .where(inArray(testTags.testId, testIds)) : [];

    // Group tags by test ID
    const testTagsMap = new Map<string, Array<{ id: string; name: string; color: string | null }>>();
    testTagsForJob.forEach(({ testId, tagId, tagName, tagColor }) => {
      if (!testTagsMap.has(testId)) {
        testTagsMap.set(testId, []);
      }
      testTagsMap.get(testId)!.push({
        id: tagId,
        name: tagName,
        color: tagColor,
      });
    });
    
    const response = {
      ...job,
      lastRunAt: job.lastRunAt ? job.lastRunAt.toISOString() : null,
      nextRunAt: job.nextRunAt ? job.nextRunAt.toISOString() : null,
      tests: testsResult.map((test) => ({
        ...test,
        name: test.title || "",
        script: test.script, // Return as-is, let frontend handle decoding
        tags: testTagsMap.get(test.id) || [],
        createdAt: test.createdAt ? test.createdAt.toISOString() : null,
        updatedAt: test.updatedAt ? test.updatedAt.toISOString() : null,
      })),
      createdAt: job.createdAt ? job.createdAt.toISOString() : null,
      updatedAt: job.updatedAt ? job.updatedAt.toISOString() : null,
    };
    
    return NextResponse.json(response);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error fetching job:", error);
    return NextResponse.json(
      { error: "Failed to fetch job" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
) {
  const params = await routeContext.params;
  const jobId = params.id;

  try {
    const context = await requireAuthContext();
    const { userId, project, organizationId } = context;

    const canUpdate = checkPermissionWithContext("job", "update", context);
    if (!canUpdate) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const rawData = await request.json();

    // Fetch existing job to get required fields for updateJob action
    const existingJob = await db.query.jobs.findFirst({
      where: and(
        eq(jobs.id, jobId),
        eq(jobs.projectId, project.id),
        eq(jobs.organizationId, organizationId)
      ),
    });

    if (!existingJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Fetch current tests for the job
    const currentTests = await db
      .select({ id: testsTable.id })
      .from(testsTable)
      .innerJoin(jobTests, eq(testsTable.id, jobTests.testId))
      .where(eq(jobTests.jobId, jobId))
      .orderBy(asc(jobTests.orderPosition));

    // Merge updates
    const updateData = {
      jobId,
      name: rawData.name !== undefined ? rawData.name : existingJob.name,
      description: rawData.description !== undefined ? rawData.description : (existingJob.description || ""),
      cronSchedule: rawData.cronSchedule !== undefined ? rawData.cronSchedule : (existingJob.cronSchedule || ""),
      tests: rawData.tests !== undefined ? rawData.tests : currentTests.map(t => ({ id: t.id })),
      alertConfig: rawData.alertConfig !== undefined ? rawData.alertConfig : (existingJob.alertConfig || undefined),
    } as any; // Cast as any to bypass strict UpdateJobData if needed, though structure matches

    const result = await updateJob(updateData);

    if (result.success) {
      return NextResponse.json(result.job);
    } else {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error partially updating job:", error);
    return NextResponse.json(
      { error: "Failed to update job" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
) {
  const params = await routeContext.params;
  try {
    const context = await requireAuthContext();

    const canUpdate = checkPermissionWithContext("job", "update", context);
    if (!canUpdate) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Verify job belongs to current project before updating
    const existingJob = await db.query.jobs.findFirst({
      where: and(
        eq(jobs.id, params.id),
        eq(jobs.projectId, context.project.id),
        eq(jobs.organizationId, context.organizationId)
      ),
    });

    if (!existingJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const body = await request.json();
    const result = await updateJob({
      jobId: params.id,
      ...body
    });
    
    if (result.success) {
      return NextResponse.json(result.job);
    } else {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error updating job:", error);
    return NextResponse.json(
      { error: "Failed to update job" },
      { status: 500 }
    );
  }
} 