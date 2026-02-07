import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { k6PerformanceRuns, jobs } from "@/db/schema";
import { eq, and, desc, gte, count, sql, avg } from "drizzle-orm";
import { subDays } from "date-fns";
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { requireAuthContext, isAuthError } from '@/lib/auth-context';

/**
 * K6 Analytics API
 * 
 * GET /api/analytics/k6
 * Query params:
 *   - jobId (optional): Filter to specific job
 *   - period: 30 | 60 | 90 (days, default 30)
 *   - leftRunId (optional): First run for comparison
 *   - rightRunId (optional): Second run for comparison
 * 
 * Returns historical K6 performance metrics for trend analysis and run comparison.
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    const { organizationId } = context;
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
    const leftRunId = searchParams.get('leftRunId');
    const rightRunId = searchParams.get('rightRunId');

    // Validate period
    const validPeriods = [30, 60, 90];
    const periodDays = validPeriods.includes(period) ? period : 30;
    
    const now = new Date();
    const startDate = subDays(now, periodDays);
    const dbInstance = db;

    // Build base conditions
    // Filter by jobId IS NOT NULL to exclude playground executions from analytics
    // Analytics should only include job-triggered runs for proper comparison
    const baseConditions = [
      gte(k6PerformanceRuns.startedAt, startDate),
      eq(k6PerformanceRuns.projectId, targetProjectId),
      eq(k6PerformanceRuns.organizationId, organizationId),
      sql`${k6PerformanceRuns.completedAt} IS NOT NULL`,
      sql`${k6PerformanceRuns.jobId} IS NOT NULL`
    ];

    if (jobId) {
      baseConditions.push(eq(k6PerformanceRuns.jobId, jobId));
    }

    // OPTIMIZED: Execute all independent queries in parallel using Promise.all
    const [k6Jobs, historicalRuns, aggregateStats] = await Promise.all([
      // 1. Fetch K6 jobs
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
            eq(jobs.organizationId, organizationId),
            eq(jobs.jobType, 'k6')
          )
        )
        .orderBy(desc(jobs.lastRunAt)),

      // 2. Fetch historical runs
      dbInstance
        .select({
          id: k6PerformanceRuns.id,
          runId: k6PerformanceRuns.runId,
          jobId: k6PerformanceRuns.jobId,
          status: k6PerformanceRuns.status,
          startedAt: k6PerformanceRuns.startedAt,
          completedAt: k6PerformanceRuns.completedAt,
          durationMs: k6PerformanceRuns.durationMs,
          thresholdsPassed: k6PerformanceRuns.thresholdsPassed,
          totalRequests: k6PerformanceRuns.totalRequests,
          failedRequests: k6PerformanceRuns.failedRequests,
          requestRate: k6PerformanceRuns.requestRate,
          avgResponseTimeMs: k6PerformanceRuns.avgResponseTimeMs,
          p95ResponseTimeMs: k6PerformanceRuns.p95ResponseTimeMs,
          p99ResponseTimeMs: k6PerformanceRuns.p99ResponseTimeMs,
          vusMax: k6PerformanceRuns.vusMax,
          jobName: jobs.name,
        })
        .from(k6PerformanceRuns)
        .leftJoin(jobs, eq(k6PerformanceRuns.jobId, jobs.id))
        .where(and(...baseConditions))
        .orderBy(desc(k6PerformanceRuns.startedAt))
        .limit(100),

      // 3. Calculate aggregate stats
      dbInstance
        .select({
          totalRuns: count(),
          avgP95: avg(k6PerformanceRuns.p95ResponseTimeMs),
          avgP99: avg(k6PerformanceRuns.p99ResponseTimeMs),
          avgResponseTime: avg(k6PerformanceRuns.avgResponseTimeMs),
          avgRequestRate: avg(k6PerformanceRuns.requestRate),
          totalRequests: sql<number>`SUM(${k6PerformanceRuns.totalRequests})`,
          passedRuns: sql<number>`SUM(CASE WHEN ${k6PerformanceRuns.status} = 'passed' THEN 1 ELSE 0 END)`,
          failedRuns: sql<number>`SUM(CASE WHEN ${k6PerformanceRuns.status} = 'failed' THEN 1 ELSE 0 END)`,
        })
        .from(k6PerformanceRuns)
        .leftJoin(jobs, eq(k6PerformanceRuns.jobId, jobs.id))
        .where(and(...baseConditions))
    ]);

    const stats = aggregateStats[0];
    const totalRuns = Number(stats?.totalRuns) || 0;
    const passedRuns = Number(stats?.passedRuns) || 0;
    const passRate = totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100 * 10) / 10 : 0;

    // If comparison is requested, fetch both runs
    let comparisonData = null;
    if (leftRunId && rightRunId) {
      const [leftRun, rightRun] = await Promise.all([
        dbInstance
          .select({
            id: k6PerformanceRuns.id,
            runId: k6PerformanceRuns.runId,
            jobId: k6PerformanceRuns.jobId,
            status: k6PerformanceRuns.status,
            startedAt: k6PerformanceRuns.startedAt,
            completedAt: k6PerformanceRuns.completedAt,
            durationMs: k6PerformanceRuns.durationMs,
            thresholdsPassed: k6PerformanceRuns.thresholdsPassed,
            totalRequests: k6PerformanceRuns.totalRequests,
            failedRequests: k6PerformanceRuns.failedRequests,
            requestRate: k6PerformanceRuns.requestRate,
            avgResponseTimeMs: k6PerformanceRuns.avgResponseTimeMs,
            p95ResponseTimeMs: k6PerformanceRuns.p95ResponseTimeMs,
            p99ResponseTimeMs: k6PerformanceRuns.p99ResponseTimeMs,
            vusMax: k6PerformanceRuns.vusMax,
            reportS3Url: k6PerformanceRuns.reportS3Url,
            jobName: jobs.name,
          })
          .from(k6PerformanceRuns)
          .leftJoin(jobs, eq(k6PerformanceRuns.jobId, jobs.id))
          .where(
            and(
              eq(k6PerformanceRuns.runId, leftRunId),
              eq(k6PerformanceRuns.projectId, targetProjectId),
              eq(k6PerformanceRuns.organizationId, organizationId)
            )
          )
          .limit(1),
        dbInstance
          .select({
            id: k6PerformanceRuns.id,
            runId: k6PerformanceRuns.runId,
            jobId: k6PerformanceRuns.jobId,
            status: k6PerformanceRuns.status,
            startedAt: k6PerformanceRuns.startedAt,
            completedAt: k6PerformanceRuns.completedAt,
            durationMs: k6PerformanceRuns.durationMs,
            thresholdsPassed: k6PerformanceRuns.thresholdsPassed,
            totalRequests: k6PerformanceRuns.totalRequests,
            failedRequests: k6PerformanceRuns.failedRequests,
            requestRate: k6PerformanceRuns.requestRate,
            avgResponseTimeMs: k6PerformanceRuns.avgResponseTimeMs,
            p95ResponseTimeMs: k6PerformanceRuns.p95ResponseTimeMs,
            p99ResponseTimeMs: k6PerformanceRuns.p99ResponseTimeMs,
            vusMax: k6PerformanceRuns.vusMax,
            reportS3Url: k6PerformanceRuns.reportS3Url,
            jobName: jobs.name,
          })
          .from(k6PerformanceRuns)
          .leftJoin(jobs, eq(k6PerformanceRuns.jobId, jobs.id))
          .where(
            and(
              eq(k6PerformanceRuns.runId, rightRunId),
              eq(k6PerformanceRuns.projectId, targetProjectId),
              eq(k6PerformanceRuns.organizationId, organizationId)
            )
          )
          .limit(1),
      ]);

      if (leftRun[0] && rightRun[0]) {
        const left = leftRun[0];
        const right = rightRun[0];

        // Calculate deltas (positive = right is better for response times, worse for other metrics)
        const calculateDelta = (leftVal: number | null, rightVal: number | null) => {
          if (leftVal === null || rightVal === null) return null;
          return rightVal - leftVal;
        };

        const calculatePercentDelta = (leftVal: number | null, rightVal: number | null) => {
          if (leftVal === null || rightVal === null || leftVal === 0) return null;
          return Math.round(((rightVal - leftVal) / leftVal) * 100 * 10) / 10;
        };

        comparisonData = {
          left: {
            id: left.id,
            runId: left.runId,
            jobId: left.jobId,
            jobName: left.jobName,
            status: left.status,
            startedAt: left.startedAt?.toISOString(),
            completedAt: left.completedAt?.toISOString(),
            durationMs: left.durationMs,
            thresholdsPassed: left.thresholdsPassed,
            requestRate: left.requestRate ? left.requestRate / 100 : null,
            reportS3Url: left.reportS3Url,
            metrics: {
              totalRequests: left.totalRequests,
              failedRequests: left.failedRequests,
              requestRate: left.requestRate ? left.requestRate / 100 : null,
              avgResponseTimeMs: left.avgResponseTimeMs,
              p95ResponseTimeMs: left.p95ResponseTimeMs,
              p99ResponseTimeMs: left.p99ResponseTimeMs,
              vusMax: left.vusMax,
            },
          },
          right: {
            id: right.id,
            runId: right.runId,
            jobId: right.jobId,
            jobName: right.jobName,
            status: right.status,
            startedAt: right.startedAt?.toISOString(),
            completedAt: right.completedAt?.toISOString(),
            durationMs: right.durationMs,
            thresholdsPassed: right.thresholdsPassed,
            requestRate: right.requestRate ? right.requestRate / 100 : null,
            reportS3Url: right.reportS3Url,
            metrics: {
              totalRequests: right.totalRequests,
              failedRequests: right.failedRequests,
              requestRate: right.requestRate ? right.requestRate / 100 : null,
              avgResponseTimeMs: right.avgResponseTimeMs,
              p95ResponseTimeMs: right.p95ResponseTimeMs,
              p99ResponseTimeMs: right.p99ResponseTimeMs,
              vusMax: right.vusMax,
            },
          },
          deltas: {
            p95ResponseTimeMs: calculateDelta(left.p95ResponseTimeMs, right.p95ResponseTimeMs),
            p95ResponseTimePercent: calculatePercentDelta(left.p95ResponseTimeMs, right.p95ResponseTimeMs),
            p99ResponseTimeMs: calculateDelta(left.p99ResponseTimeMs, right.p99ResponseTimeMs),
            p99ResponseTimePercent: calculatePercentDelta(left.p99ResponseTimeMs, right.p99ResponseTimeMs),
            avgResponseTimeMs: calculateDelta(left.avgResponseTimeMs, right.avgResponseTimeMs),
            avgResponseTimePercent: calculatePercentDelta(left.avgResponseTimeMs, right.avgResponseTimeMs),
            totalRequests: calculateDelta(left.totalRequests, right.totalRequests),
            totalRequestsPercent: calculatePercentDelta(left.totalRequests, right.totalRequests),
            failedRequests: calculateDelta(left.failedRequests, right.failedRequests),
            requestRate: left.requestRate && right.requestRate 
              ? calculateDelta(left.requestRate / 100, right.requestRate / 100) 
              : null,
            requestRatePercent: left.requestRate && right.requestRate
              ? calculatePercentDelta(left.requestRate, right.requestRate)
              : null,
            vusMax: calculateDelta(left.vusMax, right.vusMax),
            durationMs: calculateDelta(left.durationMs, right.durationMs),
            durationPercent: calculatePercentDelta(left.durationMs, right.durationMs),
          }
        };
      }
    }

    // Format runs for response
    const formattedRuns = historicalRuns.map((run, index) => {
      const prevRun = historicalRuns[index + 1];
      const p95Delta = prevRun && run.p95ResponseTimeMs !== null && prevRun.p95ResponseTimeMs !== null
        ? run.p95ResponseTimeMs - prevRun.p95ResponseTimeMs
        : null;

      return {
        id: run.id,
        runId: run.runId,
        jobId: run.jobId,
        jobName: run.jobName,
        status: run.status,
        startedAt: run.startedAt?.toISOString(),
        completedAt: run.completedAt?.toISOString(),
        durationMs: run.durationMs,
        thresholdsPassed: run.thresholdsPassed,
        metrics: {
          totalRequests: run.totalRequests,
          failedRequests: run.failedRequests,
          requestRate: run.requestRate ? run.requestRate / 100 : null, // Convert back from scaled value
          avgResponseTimeMs: run.avgResponseTimeMs,
          p95ResponseTimeMs: run.p95ResponseTimeMs,
          p99ResponseTimeMs: run.p99ResponseTimeMs,
          vusMax: run.vusMax,
        },
        delta: {
          p95: p95Delta,
        }
      };
    });

    // Prepare chart data (for simple line charts)
    const chartData = formattedRuns
      .slice()
      .reverse() // Oldest first for charts
      .map(run => ({
        date: run.startedAt,
        p95: run.metrics.p95ResponseTimeMs,
        p99: run.metrics.p99ResponseTimeMs,
        avg: run.metrics.avgResponseTimeMs,
        requestRate: run.metrics.requestRate,
        status: run.status,
      }));

    const response = NextResponse.json({
      jobs: k6Jobs,
      runs: formattedRuns,
      stats: {
        totalRuns,
        passedRuns,
        failedRuns: Number(stats?.failedRuns) || 0,
        passRate,
        avgP95: Math.round(Number(stats?.avgP95) || 0),
        avgP99: Math.round(Number(stats?.avgP99) || 0),
        avgResponseTime: Math.round(Number(stats?.avgResponseTime) || 0),
        avgRequestRate: Math.round((Number(stats?.avgRequestRate) || 0) / 100 * 10) / 10, // Convert and round
        totalRequests: Number(stats?.totalRequests) || 0,
      },
      chartData,
      comparison: comparisonData,
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
    console.error("K6 Analytics API error:", error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { error: "Failed to fetch K6 analytics data" },
      { status: 500 }
    );
  }
}
