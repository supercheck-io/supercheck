import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { jobs, runs } from "@/db/schema";
import { eq, and, desc, gte, count, sql, avg } from "drizzle-orm";
import { subDays } from "date-fns";
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { requireAuthContext, isAuthError } from '@/lib/auth-context';

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
    const context = await requireAuthContext();
    const targetProjectId = context.project.id;
    
    // Check permissions
    const canView = checkPermissionWithContext('project', 'view', context);
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

    // Build conditions for runs query
    const baseRunConditions = [
      gte(runs.startedAt, startDate),
      eq(runs.projectId, targetProjectId),
      sql`${runs.completedAt} IS NOT NULL`
    ];

    if (jobId) {
      baseRunConditions.push(eq(runs.jobId, jobId));
    }

    // OPTIMIZED: Execute all independent queries in parallel using Promise.all
    const [playwrightJobs, historicalRuns, aggregateStats, runsPerDay] = await Promise.all([
      // 1. Fetch Playwright jobs
      dbInstance
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
            eq(jobs.organizationId, context.organizationId),
            eq(jobs.jobType, 'playwright')
          )
        )
        .orderBy(desc(jobs.lastRunAt)),

      // 2. Fetch historical runs
      dbInstance
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
            eq(jobs.organizationId, context.organizationId)
          )
        )
        .orderBy(desc(runs.startedAt))
        .limit(100),

      // 3. Calculate aggregate stats
      dbInstance
        .select({
          totalRuns: count(),
          avgDurationMs: avg(runs.durationMs),
          passedRuns: sql<number>`SUM(CASE WHEN ${runs.status} = 'passed' THEN 1 ELSE 0 END)`,
          failedRuns: sql<number>`SUM(CASE WHEN ${runs.status} = 'failed' THEN 1 ELSE 0 END)`,
          totalDurationMs: sql<number>`SUM(COALESCE(${runs.durationMs}, 0))`,
        })
        .from(runs)
        .innerJoin(jobs, eq(runs.jobId, jobs.id))
        .where(
          and(
            ...baseRunConditions,
            eq(jobs.jobType, 'playwright'),
            eq(jobs.organizationId, context.organizationId)
          )
        ),

      // 4. Calculate runs per day
      dbInstance
        .select({
          date: sql<string>`DATE(${runs.startedAt})`,
          count: count(),
          passed: sql<number>`SUM(CASE WHEN ${runs.status} = 'passed' THEN 1 ELSE 0 END)`,
          failed: sql<number>`SUM(CASE WHEN ${runs.status} = 'failed' THEN 1 ELSE 0 END)`,
        })
        .from(runs)
        .innerJoin(jobs, eq(runs.jobId, jobs.id))
        .where(
          and(
            ...baseRunConditions,
            eq(jobs.jobType, 'playwright'),
            eq(jobs.organizationId, context.organizationId)
          )
        )
        .groupBy(sql`DATE(${runs.startedAt})`)
        .orderBy(sql`DATE(${runs.startedAt})`)
    ]);

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
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
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
