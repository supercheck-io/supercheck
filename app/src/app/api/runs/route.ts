import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { runs, jobs, reports, TestRunStatus } from "@/db/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import { requireAuth } from '@/lib/rbac/middleware';

export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const projectId = searchParams.get('projectId');
    const organizationId = searchParams.get('organizationId');
    const jobId = searchParams.get('jobId');
    const status = searchParams.get('status');

    // Validate pagination parameters
    if (page < 1 || limit < 1 || limit > 100) {
      return NextResponse.json(
        { error: 'Invalid pagination parameters. Page must be >= 1, limit must be 1-100' },
        { status: 400 }
      );
    }

    const offset = (page - 1) * limit;

    // Build filters
    const filters = [];
    if (projectId) filters.push(eq(runs.projectId, projectId));
    if (organizationId) filters.push(eq(jobs.organizationId, organizationId));
    if (jobId) filters.push(eq(runs.jobId, jobId));
    if (status) {
      // Validate status is a valid TestRunStatus
      const validStatuses: TestRunStatus[] = ["running", "passed", "failed", "error"];
      if (validStatuses.includes(status as TestRunStatus)) {
        filters.push(eq(runs.status, status as TestRunStatus));
      }
    }

    const whereCondition = filters.length > 0 ? and(...filters) : undefined;

    // Get total count
    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(runs)
      .leftJoin(jobs, eq(runs.jobId, jobs.id));

    const [{ count: totalCount }] = whereCondition
      ? await countQuery.where(whereCondition)
      : await countQuery;

    const total = Number(totalCount);

    // Get paginated results with all details
    let dataQuery = db
      .select({
        id: runs.id,
        jobId: runs.jobId,
        jobName: jobs.name,
        status: runs.status,
        duration: runs.duration,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        logs: runs.logs,
        errorDetails: runs.errorDetails,
        reportUrl: reports.s3Url,
        trigger: runs.trigger,
      })
      .from(runs)
      .leftJoin(jobs, eq(runs.jobId, jobs.id))
      .leftJoin(
        reports,
        and(
          sql`${reports.entityId} = ${runs.id}::text`,
          eq(reports.entityType, 'job')
        )
      )
      .orderBy(desc(runs.startedAt))
      .limit(limit)
      .offset(offset);

    if (whereCondition) {
      dataQuery = dataQuery.where(whereCondition) as typeof dataQuery;
    }

    const result = await dataQuery;

    // Convert dates to ISO strings
    const formattedRuns = result.map(run => ({
      ...run,
      startedAt: run.startedAt ? run.startedAt.toISOString() : null,
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    }));

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return NextResponse.json({
      data: formattedRuns,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    console.error('Error fetching runs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch runs' },
      { status: 500 }
    );
  }
}
