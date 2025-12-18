import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { runs, jobs, reports, TestRunStatus } from "@/db/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import { hasPermission } from '@/lib/rbac/middleware';
import { requireProjectContext } from '@/lib/project-context';

export async function GET(request: NextRequest) {
  try {
    // Require authentication and project context
    const { project, organizationId } = await requireProjectContext();

    // Check permission to view runs
    const canView = await hasPermission('job', 'view', {
      organizationId,
      projectId: project.id
    });

    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limitParam = searchParams.get('limit');
    const jobId = searchParams.get('jobId');
    const status = searchParams.get('status');

    // If no limit specified, fetch all data (for client-side filtering)
    // If limit specified, use pagination (max 1000 for safety)
    const fetchAll = !limitParam;
    const limit = fetchAll ? 1000 : Math.min(parseInt(limitParam || '10', 10), 1000);

    // Validate pagination parameters
    if (page < 1 || limit < 1) {
      return NextResponse.json(
        { error: 'Invalid pagination parameters. Page must be >= 1, limit must be >= 1' },
        { status: 400 }
      );
    }

    const offset = fetchAll ? 0 : (page - 1) * limit;

    // SECURITY: Always filter by org/project from session, never trust client params
    const filters = [
      eq(runs.projectId, project.id),
      eq(jobs.organizationId, organizationId)
    ];
    
    // Optional additional filters
    if (jobId) filters.push(eq(runs.jobId, jobId));
    if (status) {
      // Validate status is a valid TestRunStatus
      const validStatuses: TestRunStatus[] = ["running", "passed", "failed", "error"];
      if (validStatuses.includes(status as TestRunStatus)) {
        filters.push(eq(runs.status, status as TestRunStatus));
      }
    }

    const whereCondition = and(...filters);

    // Get total count
    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(runs)
      .leftJoin(jobs, eq(runs.jobId, jobs.id))
      .where(whereCondition);

    const [{ count: totalCount }] = await countQuery;

    const total = Number(totalCount);

    // Get paginated results with all details
    const result = await db
      .select({
        id: runs.id,
        jobId: runs.jobId,
        jobName: jobs.name,
        jobType: jobs.jobType,
        status: runs.status,
        durationMs: runs.durationMs,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        // logs: runs.logs, // OPTIMIZED: Exclude logs from list view to reduce payload size
        // errorDetails: runs.errorDetails, // OPTIMIZED: Exclude full error details from list view
        reportUrl: reports.s3Url,
        trigger: runs.trigger,
        location: runs.location,
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
      .where(whereCondition)
      .orderBy(desc(runs.startedAt))
      .limit(limit)
      .offset(offset);

    // Convert dates to ISO strings and format duration
    const formattedRuns = result.map(run => {
      const computeDuration = () => {
        // Use durationMs if available
        if (run.durationMs !== null && run.durationMs !== undefined && run.durationMs > 0) {
          const seconds = Math.round(run.durationMs / 1000);
          if (seconds >= 60) {
            const minutes = Math.floor(seconds / 60);
            const remainder = seconds % 60;
            return `${minutes}m${remainder ? ` ${remainder}s` : ""}`.trim();
          }
          if (seconds === 0) {
            return "<1s";
          }
          return `${seconds}s`;
        }
        // Fallback to calculating from timestamps
        if (run.startedAt && run.completedAt) {
          const start = run.startedAt.getTime();
          const end = run.completedAt.getTime();
          if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
            const seconds = Math.round((end - start) / 1000);
            if (seconds >= 60) {
              const minutes = Math.floor(seconds / 60);
              const remainder = seconds % 60;
              return `${minutes}m${remainder ? ` ${remainder}s` : ""}`.trim();
            }
            if (seconds === 0) {
              return "<1s";
            }
            if (seconds > 0) {
              return `${seconds}s`;
            }
          }
        }
        return null;
      };

      return {
        ...run,
        duration: computeDuration(),
        startedAt: run.startedAt ? run.startedAt.toISOString() : null,
        completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      };
    });

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
