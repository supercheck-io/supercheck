import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import {
  monitors,
  monitorResults,
  jobs,
  runs,
  tests,
  auditLogs,
  reports,
  k6PerformanceRuns,
} from "@/db/schema";
import { eq, gte, and, count, sql, sum, inArray, isNull } from "drizzle-orm";
import { subDays, subHours } from "date-fns";
import { getQueueStats } from "@/lib/queue-stats";
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { requireAuthContext, isAuthError, authErrorStatus } from '@/lib/auth-context';
import { excludeSyntheticResults } from "@/lib/monitor-result-filters";
import { getRowCountsByPeriod } from "@/lib/monitor-availability";
import { buildSystemIssues } from "@/lib/dashboard/system-health";
import { FAILED_RUN_STATUSES } from "@/lib/dashboard/run-outcomes";

export async function GET() {
  try {
    const context = await requireAuthContext();
    
    // Use current project context - no need for query params
    const targetProjectId = context.project.id;
    
    // PERFORMANCE: Use checkPermissionWithContext to avoid 5-8 duplicate DB queries
    const canView = checkPermissionWithContext('project', 'view', context);
    
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const dbInstance = db;
    const now = new Date();
    const last24Hours = subHours(now, 24);
    const last7Days = subDays(now, 7);
    const last30Days = subDays(now, 30);

    // Get queue statistics
    // A queue-stats failure must not 500 the whole dashboard
    const queueStats = await getQueueStats(context.organizationId).catch((error) => {
      console.error("Dashboard queue stats error:", error instanceof Error ? error.message : "Unknown error");
      return { running: 0, queued: 0, runningCapacity: 0, queuedCapacity: 0 };
    });

    // Monitor Statistics - scoped to project
    // OPTIMIZED: Consolidated 4 separate count queries into 1 using PostgreSQL FILTER clause
    const availabilityScope = { organizationId: context.organizationId, projectId: targetProjectId, now };

    const monitorBaseCondition = and(
      eq(monitors.projectId, targetProjectId),
      eq(monitors.organizationId, context.organizationId),
      isNull(monitors.deletingAt)
    );
    
    const [
      monitorCounts,
      recentMonitorCounts,
      monitorsByType,
      criticalAlerts
    ] = await Promise.all([
      // OPTIMIZED: Single query for all monitor counts using FILTER
      // COALESCE ensures 0 instead of NULL when no rows match
      dbInstance.select({
        total: count(),
        active: sql<number>`COALESCE(count(*) filter (where ${monitors.enabled} = true), 0)`.mapWith(Number),
        up: sql<number>`COALESCE(count(*) filter (where ${monitors.status} = 'up'), 0)`.mapWith(Number),
        down: sql<number>`COALESCE(count(*) filter (where ${monitors.status} = 'down'), 0)`.mapWith(Number),
        paused: sql<number>`COALESCE(count(*) filter (where ${monitors.status} = 'paused'), 0)`.mapWith(Number),
        pending: sql<number>`COALESCE(count(*) filter (where ${monitors.status} = 'pending'), 0)`.mapWith(Number),
        maintenance: sql<number>`COALESCE(count(*) filter (where ${monitors.status} = 'maintenance'), 0)`.mapWith(Number),
        error: sql<number>`COALESCE(count(*) filter (where ${monitors.status} = 'error'), 0)`.mapWith(Number),
      }).from(monitors)
        .where(monitorBaseCondition),
      
      // Recent monitor results (last 24h): hourly aggregates plus raw rows for the unaggregated rest
      getRowCountsByPeriod({ ...availabilityScope, from: last24Hours, period: "hourly" }),

      // Monitor count by type
      dbInstance.select({
        type: monitors.type,
        count: count()
      }).from(monitors)
        .where(monitorBaseCondition)
        .groupBy(monitors.type),
      
      // Critical alerts (down monitors)
      dbInstance.select({
        id: monitors.id,
        name: monitors.name,
        type: monitors.type,
        status: monitors.status,
        lastCheckAt: monitors.lastCheckAt
      }).from(monitors)
        .where(and(eq(monitors.status, "down"), eq(monitors.projectId, targetProjectId), eq(monitors.organizationId, context.organizationId), isNull(monitors.deletingAt)))
        .limit(5)
    ]);

    const recentChecks24h = [...recentMonitorCounts.values()].reduce(
      (acc, c) => ({ total: acc.total + c.total, up: acc.up + c.up }),
      { total: 0, up: 0 },
    );

    // Job Statistics - scoped to project
    // OPTIMIZED: Consolidated count queries using PostgreSQL FILTER clause
    const jobBaseCondition = and(
      eq(jobs.projectId, targetProjectId),
      eq(jobs.organizationId, context.organizationId),
      isNull(jobs.deletingAt)
    );
    
    // Run-based cards are Playwright-only; k6 runs are read from k6_performance_runs.
    // The 24h/7d failure signals (system health, needs attention) cover every job type so failed k6 job runs still surface.
    const playwrightJobCondition = and(jobBaseCondition, eq(jobs.jobType, "playwright"));

    const [
      jobCounts,
      recentRuns,
      runCounts24h,
      jobsByStatus,
      failedRuns7d,
      jobTriggerTrend,
      executionTimeData
    ] = await Promise.all([
      // OPTIMIZED: Single query for total and active job counts
      dbInstance.select({
        total: count(),
        active: sql<number>`count(*) filter (where ${jobs.status} = 'running')`.mapWith(Number),
        // Jobs with a cron schedule configured (what the dashboard calls "scheduled")
        scheduled: sql<number>`count(*) filter (where ${jobs.cronSchedule} is not null and ${jobs.cronSchedule} <> '')`.mapWith(Number),
      }).from(jobs)
        .where(jobBaseCondition),
      
      // Recent runs (last 30 days) - only for jobs in this project
      dbInstance.select({
        count: count(),
        passed: sql<number>`count(*) filter (where ${runs.status} = 'passed')`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${runs.status} in ('failed', 'error'))`.mapWith(Number),
      })
        .from(runs)
        .innerJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last30Days),
          playwrightJobCondition
        )),
      
      // OPTIMIZED: Single query for successful and failed runs in last 24h
      dbInstance.select({
        total: count(),
        passed: sql<number>`count(*) filter (where ${runs.status} = 'passed')`.mapWith(Number),
        // `error` is a failure too (see lib/dashboard/run-outcomes.ts)
        failed: sql<number>`count(*) filter (where ${runs.status} in ('failed', 'error'))`.mapWith(Number),
      })
        .from(runs)
        .innerJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last24Hours),
          jobBaseCondition
        )),
      
      // Jobs by status
      dbInstance.select({
        status: jobs.status,
        count: count()
      }).from(jobs)
        .where(jobBaseCondition)
        .groupBy(jobs.status),
      
      // Failed runs in the last 7 days by trigger, for the Needs attention chart (unknown triggers count as manual)
      dbInstance.select({
        total: count(),
        scheduled: sql<number>`count(*) filter (where ${runs.trigger} = 'schedule')`.mapWith(Number),
        remote: sql<number>`count(*) filter (where ${runs.trigger} = 'remote')`.mapWith(Number),
      }).from(runs)
        .innerJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last7Days),
          inArray(runs.status, [...FAILED_RUN_STATUSES]),
          jobBaseCondition
        )),

      // Daily job runs by trigger (last 30 days); unknown triggers count as manual
      dbInstance.select({
        // Text, not a DATE the driver parses into a local-midnight Date that can shift the day
        date: sql<string>`to_char(DATE(${runs.startedAt}), 'YYYY-MM-DD')`,
        total: count(),
        scheduled: sql<number>`count(*) filter (where ${runs.trigger} = 'schedule')`.mapWith(Number),
        remote: sql<number>`count(*) filter (where ${runs.trigger} = 'remote')`.mapWith(Number),
      }).from(runs)
        .innerJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(gte(runs.startedAt, last30Days), playwrightJobCondition))
        .groupBy(sql`DATE(${runs.startedAt})`)
        .orderBy(sql`DATE(${runs.startedAt})`),

      // OPTIMIZED: Total execution time using SQL aggregation instead of fetching all rows
      // Now returns aggregated stats directly rather than raw data
      dbInstance.select({
        totalMs: sql<number>`COALESCE(SUM(${runs.durationMs}), 0)`.mapWith(Number),
        avgMs: sql<number>`COALESCE(AVG(${runs.durationMs}), 0)`.mapWith(Number),
        count: count(),
      }).from(runs)
        .leftJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last30Days),
          playwrightJobCondition,
          // Only include completed runs with valid duration
          sql`${runs.completedAt} IS NOT NULL`,
          sql`${runs.durationMs} IS NOT NULL`,
          sql`${runs.durationMs} >= 0`,
          sql`${runs.durationMs} <= 86400000` // Max 24 hours in ms
        ))
    ]);

    // Test Statistics - scoped to project
    const [
      totalTests,
      testsByType,
      playgroundExecutions30d,
      k6Stats,
    ] = await Promise.all([
      // Total tests
      dbInstance.select({ count: count() }).from(tests)
        .where(and(eq(tests.projectId, targetProjectId), eq(tests.organizationId, context.organizationId))),
      
      // Tests by type
      dbInstance.select({
        type: tests.type,
        count: count()
      }).from(tests)
        .where(and(eq(tests.projectId, targetProjectId), eq(tests.organizationId, context.organizationId)))
        .groupBy(tests.type),
      
      // Playground test executions (last 30 days) from audit logs
      dbInstance.select({ count: count() })
        .from(auditLogs)
        .where(and(
          eq(auditLogs.action, 'playground_test_executed'),
          eq(auditLogs.organizationId, context.organizationId),
          gte(auditLogs.createdAt, last30Days),
          sql`${auditLogs.details}->'metadata'->>'projectId' = ${targetProjectId}`
        )),
      
      // K6 Performance Test Statistics (last 30 days)
      // VU-minutes = sum of (vus_max * duration_minutes) for each run
      // Uses denormalized vusMax column for O(1) performance instead of JSON parsing
      dbInstance.select({
        totalRuns: count(),
        totalDurationMs: sum(k6PerformanceRuns.durationMs),
        totalVuMinutes: sql<number>`SUM(COALESCE(${k6PerformanceRuns.vusMax}, 1) * COALESCE(${k6PerformanceRuns.durationMs}, 0) / 60000.0)`.mapWith(Number),
        totalRequests: sum(k6PerformanceRuns.totalRequests),
        avgResponseTimeMs: sql<number>`AVG(${k6PerformanceRuns.avgResponseTimeMs})`.mapWith(Number)
      }).from(k6PerformanceRuns)
        .where(and(
          gte(k6PerformanceRuns.startedAt, last30Days),
          eq(k6PerformanceRuns.projectId, targetProjectId),
          eq(k6PerformanceRuns.organizationId, context.organizationId),
          sql`${k6PerformanceRuns.completedAt} IS NOT NULL`,
          // Runs of a job being deleted are gone at once (anti-join on the jobs primary key).
          sql`(${k6PerformanceRuns.jobId} IS NULL OR NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.id = ${k6PerformanceRuns.jobId} AND jobs.deleting_at IS NOT NULL))`
        )),

    ]);

    // PERFORMANCE: Run all remaining queries in parallel instead of sequential awaits
    // This batch includes: monitor aggregation, playground aggregation, uptime, availability trend, response time stats, playground trend
    const [
      monitorExecutionAggregated,
      playgroundExecutionAggregated,
      uptimeResult,
      availabilityTrend,
      responseTimeStats,
      playgroundExecutionsTrend
    ] = await Promise.all([
      // OPTIMIZED: Synthetic monitor executions - SQL aggregation instead of fetching all rows
      // This was causing CPU spikes by fetching 4000+ rows and looping in JS
      dbInstance.select({
        totalResponseTimeMs: sql<number>`COALESCE(SUM(${monitorResults.responseTimeMs}), 0)`.mapWith(Number),
        count: count(),
        validCount: sql<number>`COUNT(*) FILTER (WHERE ${monitorResults.responseTimeMs} IS NOT NULL AND ${monitorResults.responseTimeMs} >= 0 AND ${monitorResults.responseTimeMs} <= 86400000)`.mapWith(Number)
      }).from(monitorResults)
        .innerJoin(monitors, eq(monitorResults.monitorId, monitors.id))
        .where(and(
          gte(monitorResults.checkedAt, last30Days),
          eq(monitors.projectId, targetProjectId),
          eq(monitors.organizationId, context.organizationId),
          isNull(monitors.deletingAt),
          eq(monitors.type, 'synthetic_test'),
          excludeSyntheticResults
        )),

      // OPTIMIZED: Playground test executions - SQL aggregation instead of fetching all rows
      dbInstance.select({
        count: count(),
        totalDurationMs: sql<number>`COALESCE(SUM(
          CASE 
            WHEN ${reports.status} != 'running' 
              AND ${reports.createdAt} IS NOT NULL 
              AND ${reports.updatedAt} IS NOT NULL
              AND EXTRACT(EPOCH FROM (${reports.updatedAt} - ${reports.createdAt})) * 1000 >= 0
              AND EXTRACT(EPOCH FROM (${reports.updatedAt} - ${reports.createdAt})) * 1000 <= 86400000
            THEN EXTRACT(EPOCH FROM (${reports.updatedAt} - ${reports.createdAt})) * 1000
            ELSE 0
          END
        ), 0)`.mapWith(Number),
        validCount: sql<number>`COUNT(*) FILTER (WHERE ${reports.status} != 'running' AND ${reports.createdAt} IS NOT NULL AND ${reports.updatedAt} IS NOT NULL)`.mapWith(Number)
      }).from(auditLogs)
        .innerJoin(
          reports,
          and(
            eq(reports.entityType, 'test'),
            sql`${reports.entityId} = ${auditLogs.details}->>'resourceId'`
          )
        )
        .where(and(
          eq(auditLogs.action, 'playground_test_executed'),
          eq(auditLogs.organizationId, context.organizationId),
          gte(auditLogs.createdAt, last30Days),
          sql`${auditLogs.details}->'metadata'->>'projectId' = ${targetProjectId}`
        )),

      // Uptime over the last 24h: the same hourly counts as recentChecks24h
      Promise.resolve([{ totalChecks: recentChecks24h.total, successfulChecks: recentChecks24h.up }]),

      // Monitor availability trend (last 30 days): daily aggregates plus raw rows for the unaggregated rest
      getRowCountsByPeriod({ ...availabilityScope, from: last30Days, period: "daily" }).then((counts) =>
        [...counts]
          .sort(([a], [b]) => a - b)
          .map(([day, { total, up }]) => ({
            date: new Date(day).toISOString().slice(0, 10),
            upCount: up,
            totalCount: total,
          })),
      ),

      // Response time statistics - only for monitors in this project
      dbInstance.select({
        avgResponseTime: sql<number>`AVG(${monitorResults.responseTimeMs})`.mapWith(Number),
        minResponseTime: sql<number>`MIN(${monitorResults.responseTimeMs})`.mapWith(Number),
        maxResponseTime: sql<number>`MAX(${monitorResults.responseTimeMs})`.mapWith(Number)
      }).from(monitorResults)
        .innerJoin(monitors, eq(monitorResults.monitorId, monitors.id))
        .where(and(
          gte(monitorResults.checkedAt, last24Hours),
          eq(monitorResults.isUp, true),
          eq(monitors.projectId, targetProjectId),
          eq(monitors.organizationId, context.organizationId),
          isNull(monitors.deletingAt)
        )),

      // Daily playground executions breakdown (last 30 days)
      dbInstance.select({
        date: sql<string>`DATE(${auditLogs.createdAt})`,
        count: count()
      }).from(auditLogs)
        .where(and(
          eq(auditLogs.action, 'playground_test_executed'),
          eq(auditLogs.organizationId, context.organizationId),
          gte(auditLogs.createdAt, last30Days),
          sql`${auditLogs.details}->'metadata'->>'projectId' = ${targetProjectId}`
        ))
        .groupBy(sql`DATE(${auditLogs.createdAt})`)
        .orderBy(sql`DATE(${auditLogs.createdAt})`)
    ]);

    // Calculate overall uptime percentage from aggregated result
    const totalChecks = uptimeResult[0]?.totalChecks ?? 0;
    const successfulChecks = uptimeResult[0]?.successfulChecks ?? 0;
    const overallUptime = totalChecks > 0 ? (successfulChecks / totalChecks) * 100 : null;

    // OPTIMIZED: Calculate total execution time using pre-aggregated SQL data
    // This eliminates CPU spikes from looping over 5000+ records in JavaScript
    const totalExecutionTimeCalculation = (() => {
      // Job execution time from SQL aggregation
      const jobAggregate = {
        totalMs: Number(executionTimeData[0]?.totalMs) || 0,
        processed: Number(executionTimeData[0]?.count) || 0,
        skipped: 0,
        totalRecords: Number(executionTimeData[0]?.count) || 0
      };

      // OPTIMIZED: Monitor execution time from SQL aggregation (was 4000+ row loop)
      const monitorAggregate = {
        totalMs: Number(monitorExecutionAggregated[0]?.totalResponseTimeMs) || 0,
        processed: Number(monitorExecutionAggregated[0]?.validCount) || 0,
        skipped: (Number(monitorExecutionAggregated[0]?.count) || 0) - (Number(monitorExecutionAggregated[0]?.validCount) || 0),
        totalRecords: Number(monitorExecutionAggregated[0]?.count) || 0
      };

      // OPTIMIZED: Playground execution time from SQL aggregation
      const playgroundAggregate = {
        totalMs: Number(playgroundExecutionAggregated[0]?.totalDurationMs) || 0,
        processed: Number(playgroundExecutionAggregated[0]?.validCount) || 0,
        skipped: (Number(playgroundExecutionAggregated[0]?.count) || 0) - (Number(playgroundExecutionAggregated[0]?.validCount) || 0),
        totalRecords: Number(playgroundExecutionAggregated[0]?.count) || 0
      };

      const totalMs = jobAggregate.totalMs + monitorAggregate.totalMs + playgroundAggregate.totalMs;
      const processedRuns = jobAggregate.processed + monitorAggregate.processed + playgroundAggregate.processed;
      const skippedRuns = jobAggregate.skipped + monitorAggregate.skipped + playgroundAggregate.skipped;

      // Reduced logging in production - only log summary, not full details
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[EXECUTION_TIME_AUDIT] Jobs: ${jobAggregate.processed}, Monitors: ${monitorAggregate.processed}, Playground: ${playgroundAggregate.processed}, Total: ${Math.round(totalMs / 60000)}min`);
      }

      return {
        totalMs,
        totalSeconds: Math.floor(totalMs / 1000),
        totalMinutes: Math.round(totalMs / 60000 * 100) / 100,
        processedRuns,
        skippedRuns,
        errors: 0 // Errors now handled in SQL with FILTER/CASE
      };
    })();

    const response = NextResponse.json({
      // Queue Statistics
      queue: queueStats,
      
      // Monitor Statistics
      monitors: {
        total: monitorCounts[0].total,
        active: monitorCounts[0].active,
        up: monitorCounts[0].up,
        down: monitorCounts[0].down,
        paused: monitorCounts[0].paused,
        pending: monitorCounts[0].pending,
        maintenance: monitorCounts[0].maintenance,
        error: monitorCounts[0].error,
        uptime: overallUptime === null ? null : Math.round(overallUptime * 100) / 100,
        recentChecks24h: recentChecks24h.total,
        byType: monitorsByType,
        criticalAlerts: criticalAlerts,
        availabilityTrend: availabilityTrend.map(day => ({
          date: day.date,
          uptime: day.totalCount > 0 ? Math.round((day.upCount / day.totalCount) * 100 * 100) / 100 : 100
        })),
        responseTime: {
          avg: responseTimeStats[0]?.avgResponseTime != null ? Math.round(responseTimeStats[0].avgResponseTime) : null,
          min: responseTimeStats[0]?.minResponseTime ?? null,
          max: responseTimeStats[0]?.maxResponseTime ?? null
        }
      },
      
      // Job Statistics
      jobs: {
        total: jobCounts[0].total,
        active: jobCounts[0].active,
        scheduled: jobCounts[0].scheduled,
        recentRuns30d: recentRuns[0].count,
        passedRuns30d: Number(recentRuns[0].passed) || 0,
        failedRuns30d: Number(recentRuns[0].failed) || 0,
        // SUM/FILTER counts come back from Postgres as strings.
        successfulRuns24h: Number(runCounts24h[0].passed) || 0,
        failedRuns24h: Number(runCounts24h[0].failed) || 0,
        byStatus: jobsByStatus,
        failedRuns7d: (() => {
          const total = Number(failedRuns7d[0].total) || 0;
          const scheduled = Number(failedRuns7d[0].scheduled) || 0;
          const remote = Number(failedRuns7d[0].remote) || 0;
          return { manual: Math.max(0, total - scheduled - remote), scheduled, remote };
        })(),
        triggerTrend: jobTriggerTrend.map(day => {
          const total = Number(day.total) || 0;
          const scheduled = Number(day.scheduled) || 0;
          const remote = Number(day.remote) || 0;
          return { date: day.date, manual: Math.max(0, total - scheduled - remote), scheduled, remote };
        }),
        // Execution time data
        executionTime: {
          totalMs: totalExecutionTimeCalculation.totalMs,
          totalSeconds: totalExecutionTimeCalculation.totalSeconds,
          totalMinutes: totalExecutionTimeCalculation.totalMinutes,
          processedRuns: totalExecutionTimeCalculation.processedRuns,
          skippedRuns: totalExecutionTimeCalculation.skippedRuns,
          errors: totalExecutionTimeCalculation.errors,
          period: 'last 30 days'
        }
      },
      
      // Test Statistics
      tests: {
        total: totalTests[0].count,
        byType: testsByType,
        playgroundExecutions30d: playgroundExecutions30d[0].count,
        playgroundExecutionsTrend: playgroundExecutionsTrend
      },

      // K6 Performance Test Statistics (VU-minutes = VUs * duration)
      k6: {
        totalRuns: k6Stats[0]?.totalRuns || 0,
        totalDurationMs: Number(k6Stats[0]?.totalDurationMs) || 0,
        totalDurationMinutes: Math.round((Number(k6Stats[0]?.totalDurationMs) || 0) / 60000 * 100) / 100,
        totalVuMinutes: Math.round((Number(k6Stats[0]?.totalVuMinutes) || 0) * 100) / 100,
        totalRequests: Number(k6Stats[0]?.totalRequests) || 0,
        avgResponseTimeMs: Math.round(Number(k6Stats[0]?.avgResponseTimeMs) || 0),
        period: 'last 30 days'
      },

      // System Health - computed server-side so the client never rebuilds (and drops) issues
      system: (() => {
        const issues = buildSystemIssues({
          monitorsDown: Number(monitorCounts[0].down) || 0,
          downMonitors: criticalAlerts.map((a) => ({ name: a.name, type: a.type })),
          failedRuns24h: Number(runCounts24h[0].failed) || 0,
          queue: queueStats,
        });
        return {
          timestamp: now.toISOString(),
          healthy: issues.length === 0,
          issues,
        };
      })()
    });

    // NOTE: Removed Cache-Control header to ensure fresh data on every request.
    // React Query handles client-side caching; HTTP caching was causing stale data issues.
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    
    return response;

  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: authErrorStatus(error) }
      );
    }
    // Log error for debugging but avoid logging sensitive data
    console.error("Dashboard API error:", error instanceof Error ? error.message : 'Unknown error');
    
    // Return generic error message to avoid information disclosure
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
} 
