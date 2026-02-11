import { NextRequest, NextResponse } from "next/server";
import { updateJob } from "@/actions/update-job";
import { db } from "@/utils/db";
import { jobs, jobTests, runs, reports, tests as testsTable, testTags, tags } from "@/db/schema";
import { eq, inArray, asc, and } from "drizzle-orm";
import { requireAuthContext, isAuthError } from '@/lib/auth-context';
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { logAuditEvent } from '@/lib/audit-logger';
import { deleteScheduledJob } from '@/lib/job-scheduler';
import { createS3CleanupService, type ReportDeletionInput } from '@/lib/s3-cleanup';

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

    const result = await updateJob(updateData, { userId, project, organizationId });

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

/**
 * DELETE /api/jobs/[id]
 * Deletes a job with full cleanup (runs, reports, scheduler, S3, audit logging).
 * Mirrors the logic from the deleteJob server action.
 */
export async function DELETE(
  _request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await routeContext.params;
    const context = await requireAuthContext();
    const { userId, project, organizationId } = context;

    const canDelete = checkPermissionWithContext("job", "delete", context);
    if (!canDelete) {
      return NextResponse.json(
        { error: "Insufficient permissions to delete jobs" },
        { status: 403 }
      );
    }

    // Transaction: verify ownership, clean up related data, delete
    const transactionResult = await db.transaction(async (tx) => {
      const [existingJob] = await tx
        .select({ id: jobs.id, name: jobs.name, cronSchedule: jobs.cronSchedule })
        .from(jobs)
        .where(
          and(
            eq(jobs.id, id),
            eq(jobs.projectId, project.id),
            eq(jobs.organizationId, organizationId)
          )
        )
        .limit(1);

      if (!existingJob) {
        return { success: false as const, error: "Job not found" };
      }

      // Collect S3 report URLs from job-level and run-level reports
      const jobReports = await tx
        .select({ s3Url: reports.s3Url, reportPath: reports.reportPath, entityId: reports.entityId, entityType: reports.entityType })
        .from(reports)
        .where(and(eq(reports.entityId, id), eq(reports.entityType, "job")));

      const jobRuns = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(
            eq(runs.jobId, id),
            eq(runs.projectId, project.id)
          )
        );

      const runIds = jobRuns.map((r) => r.id);
      let runReports: { s3Url: string | null; reportPath: string; entityId: string; entityType: string }[] = [];
      if (runIds.length > 0) {
        runReports = await tx
          .select({ s3Url: reports.s3Url, reportPath: reports.reportPath, entityId: reports.entityId, entityType: reports.entityType })
          .from(reports)
          .where(
            and(
              inArray(reports.entityId, runIds),
              eq(reports.entityType, "job")
            )
          );
      }

      const allReportInputs: ReportDeletionInput[] = [
        ...jobReports.map((r) => ({
          reportPath: r.reportPath || undefined,
          s3Url: r.s3Url || undefined,
          entityId: r.entityId,
          entityType: (r.entityType || "job") as ReportDeletionInput["entityType"],
        })),
        ...runReports.map((r) => ({
          reportPath: r.reportPath || undefined,
          s3Url: r.s3Url || undefined,
          entityId: r.entityId,
          entityType: (r.entityType || "job") as ReportDeletionInput["entityType"],
        })),
      ];

      // Delete in dependency order, scoped to org/project for defense-in-depth
      if (runIds.length > 0) {
        await tx.delete(reports).where(
          and(
            inArray(reports.entityId, runIds),
            eq(reports.entityType, "job")
          )
        );
      }
      await tx.delete(reports).where(and(eq(reports.entityId, id), eq(reports.entityType, "job")));
      await tx.delete(runs).where(
        and(
          eq(runs.jobId, id),
          eq(runs.projectId, project.id)
        )
      );
      await tx.delete(jobTests).where(eq(jobTests.jobId, id));
      await tx.delete(jobs).where(
        and(
          eq(jobs.id, id),
          eq(jobs.projectId, project.id),
          eq(jobs.organizationId, organizationId)
        )
      );

      return {
        success: true as const,
        job: existingJob,
        reportInputs: allReportInputs,
        runCount: runIds.length,
      };
    });

    if (!transactionResult.success) {
      return NextResponse.json(
        { error: transactionResult.error },
        { status: 404 }
      );
    }

    // Post-transaction cleanup (non-blocking)

    // Unschedule from BullMQ
    try {
      await deleteScheduledJob(id);
    } catch (err) {
      console.warn(`Failed to unschedule job ${id}:`, err);
    }

    // S3 cleanup with bounded timeout
    if (transactionResult.reportInputs.length > 0) {
      try {
        const s3 = createS3CleanupService();
        const S3_CLEANUP_TIMEOUT_MS = 10_000;
        await Promise.race([
          s3.deleteReports(transactionResult.reportInputs),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('S3 cleanup timed out')), S3_CLEANUP_TIMEOUT_MS)
          ),
        ]);
      } catch (err) {
        console.warn(`S3 cleanup failed for job ${id}:`, err);
      }
    }

    await logAuditEvent({
      userId,
      organizationId,
      action: "job_deleted",
      resource: "job",
      resourceId: id,
      metadata: {
        jobName: transactionResult.job.name,
        projectId: project.id,
        runsDeleted: transactionResult.runCount,
      },
      success: true,
    });

    return NextResponse.json({ success: true, message: "Job deleted successfully" });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error deleting job:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}