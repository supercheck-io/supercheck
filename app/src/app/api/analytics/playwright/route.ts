import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { jobs, runs } from "@/db/schema";
import { eq, and, desc, gte, count, sql, avg } from "drizzle-orm";
import { subDays } from "date-fns";
import { hasPermission } from '@/lib/rbac/middleware';
import { requireProjectContext } from '@/lib/project-context';

/**
 * Playwright Analytics API
 * 
 * GET /api/analytics/playwright
 * Query params:
 *   - jobId (optional): Filter to specific job
 *   - period: 30 | 60 | 90 (days, default 30)
 * 
 * Returns historical Playwright job metrics for trend analysis.
 */
export async function GET(request: NextRequest) {
  try {
    const { project, organizationId } = await requireProjectContext();
    const targetProjectId = project.id;
    
    // Check permissions
    const canView = await hasPermission('project', 'view', { organizationId, projectId: targetProjectId });
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const jobId = searchParams.get('jobId');
    const period = parseInt(searchParams.get('period') || '30', 10);

    // Validate period
    const validPeriods = [30, 60, 90];
    const periodDays = validPeriods.includes(period) ? period : 30;
    
    const now = new Date();
    const startDate = subDays(now, periodDays);
    const dbInstance = db;

    // Fetch Playwright jobs for this project
    const playwrightJobs = await dbInstance
      .select({
        id: jobs.id,
        name: jobs.name,
        status: jobs.status,
        lastRunAt: jobs.lastRunAt,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.projectId, targetProjectId),
          eq(jobs.organizationId, organizationId),
          eq(jobs.jobType, 'playwright')
        )
      )
      .orderBy(desc(jobs.lastRunAt));

    // Build conditions for runs query
    const baseRunConditions = [
      gte(runs.startedAt, startDate),
      eq(runs.projectId, targetProjectId),
      sql`${runs.completedAt} IS NOT NULL`
    ];

    // If filtering by job, add job condition
    // Otherwise, filter to only runs from playwright jobs
    if (jobId) {
      baseRunConditions.push(eq(runs.jobId, jobId));
    }

    // Fetch historical runs - need to ensure they're from Playwright jobs
    const historicalRuns = await dbInstance
      .select({
        id: runs.id,
        jobId: runs.jobId,
        status: runs.status,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        durationMs: runs.durationMs,
        errorDetails: runs.errorDetails,
        trigger: runs.trigger,
        jobName: jobs.name,
        jobType: jobs.jobType,
      })
      .from(runs)
      .innerJoin(jobs, eq(runs.jobId, jobs.id))
      .where(
        and(
          ...baseRunConditions,
          eq(jobs.jobType, 'playwright'),
          eq(jobs.organizationId, organizationId)
        )
      )
      .orderBy(desc(runs.startedAt))
      .limit(100); // Limit for performance

    // Calculate aggregate stats
    const aggregateStats = await dbInstance
      .select({
        totalRuns: count(),
        avgDurationMs: avg(runs.durationMs),
        passedRuns: sql<number>`SUM(CASE WHEN ${runs.status} = 'passed' THEN 1 ELSE 0 END)`,
        failedRuns: sql<number>`SUM(CASE WHEN ${runs.status} = 'failed' OR ${runs.status} = 'error' THEN 1 ELSE 0 END)`,
        totalDurationMs: sql<number>`SUM(COALESCE(${runs.durationMs}, 0))`,
      })
      .from(runs)
      .innerJoin(jobs, eq(runs.jobId, jobs.id))
      .where(
        and(
          ...baseRunConditions,
          eq(jobs.jobType, 'playwright'),
          eq(jobs.organizationId, organizationId)
        )
      );

    const stats = aggregateStats[0];
    const totalRuns = Number(stats?.totalRuns) || 0;
    const passedRuns = Number(stats?.passedRuns) || 0;
    const failedRuns = Number(stats?.failedRuns) || 0;
    const passRate = totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100 * 10) / 10 : 0;
    const avgDurationMs = Math.round(Number(stats?.avgDurationMs) || 0);

    // Calculate P95 duration from the runs
    const validDurations = historicalRuns
      .map(r => r.durationMs)
      .filter((d): d is number => d !== null && d > 0)
      .sort((a, b) => a - b);
    const p95DurationMs = validDurations.length > 0
      ? Math.round(validDurations[Math.floor(validDurations.length * 0.95)] || validDurations[validDurations.length - 1] || 0)
      : 0;

    // Calculate runs per day for frequency chart
    const runsPerDay = await dbInstance
      .select({
        date: sql<string>`DATE(${runs.startedAt})`,
        count: count(),
        passed: sql<number>`SUM(CASE WHEN ${runs.status} = 'passed' THEN 1 ELSE 0 END)`,
        failed: sql<number>`SUM(CASE WHEN ${runs.status} = 'failed' OR ${runs.status} = 'error' THEN 1 ELSE 0 END)`,
      })
      .from(runs)
      .innerJoin(jobs, eq(runs.jobId, jobs.id))
      .where(
        and(
          ...baseRunConditions,
          eq(jobs.jobType, 'playwright'),
          eq(jobs.organizationId, organizationId)
        )
      )
      .groupBy(sql`DATE(${runs.startedAt})`)
      .orderBy(sql`DATE(${runs.startedAt})`);

    // Format runs for response
    const formattedRuns = historicalRuns.map((run, index) => {
      const prevRun = historicalRuns[index + 1];
      const durationDelta = prevRun && run.durationMs !== null && prevRun.durationMs !== null
        ? run.durationMs - prevRun.durationMs
        : null;
      const durationDeltaPercent = prevRun && run.durationMs !== null && prevRun.durationMs !== null && prevRun.durationMs > 0
        ? Math.round(((run.durationMs - prevRun.durationMs) / prevRun.durationMs) * 100 * 10) / 10
        : null;

      return {
        id: run.id,
        jobId: run.jobId,
        jobName: run.jobName,
        status: run.status,
        startedAt: run.startedAt?.toISOString(),
        completedAt: run.completedAt?.toISOString(),
        durationMs: run.durationMs,
        durationFormatted: formatDuration(run.durationMs),
        trigger: run.trigger,
        errorDetails: run.errorDetails ? run.errorDetails.substring(0, 200) : null, // Truncate for list view
        delta: {
          durationMs: durationDelta,
          durationPercent: durationDeltaPercent,
        }
      };
    });

    // Prepare chart data (for simple line charts)
    const chartData = formattedRuns
      .slice()
      .reverse() // Oldest first for charts
      .map(run => ({
        date: run.startedAt,
        durationMs: run.durationMs,
        durationSeconds: run.durationMs ? Math.round(run.durationMs / 1000) : null,
        status: run.status,
      }));

    const response = NextResponse.json({
      jobs: playwrightJobs,
      runs: formattedRuns,
      stats: {
        totalRuns,
        passRate,
        passedRuns,
        failedRuns,
        avgDurationMs,
        avgDurationFormatted: formatDuration(avgDurationMs),
        p95DurationMs,
        p95DurationFormatted: formatDuration(p95DurationMs),
        totalDurationMs: Number(stats?.totalDurationMs) || 0,
        totalDurationMinutes: Math.round((Number(stats?.totalDurationMs) || 0) / 60000 * 10) / 10,
      },
      chartData,
      frequencyData: runsPerDay.map(day => ({
        date: day.date,
        total: Number(day.count),
        passed: Number(day.passed),
        failed: Number(day.failed),
      })),
      period: periodDays,
      selectedJobId: jobId,
    });

    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    return response;

  } catch (error) {
    console.error("Playwright Analytics API error:", error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { error: "Failed to fetch Playwright analytics data" },
      { status: 500 }
    );
  }
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '-';
  
  if (ms < 1000) {
    return `${ms}ms`;
  }
  
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
