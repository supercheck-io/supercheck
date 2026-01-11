import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { monitors, monitorResults, jobs, runs, tests, auditLogs, reports, k6PerformanceRuns } from "@/db/schema";
import { eq, desc, gte, and, count, sql, sum } from "drizzle-orm";
import { subDays, subHours } from "date-fns";
import { getQueueStats } from "@/lib/queue-stats";
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { requireProjectContext } from '@/lib/project-context';

export async function GET() {
  try {
    const context = await requireProjectContext();
    
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
    const last30Days = subDays(now, 30);

    // Get queue statistics
    const queueStats = await getQueueStats();

    // Monitor Statistics - scoped to project
    // OPTIMIZED: Consolidated 4 separate count queries into 1 using PostgreSQL FILTER clause
    const monitorBaseCondition = and(
      eq(monitors.projectId, targetProjectId),
      eq(monitors.organizationId, context.organizationId)
    );
    
    const [
      monitorCounts,
      recentMonitorResults,
      monitorsByType,
      criticalAlerts
    ] = await Promise.all([
      // OPTIMIZED: Single query for all monitor counts using FILTER
      // COALESCE ensures 0 instead of NULL when no rows match
      dbInstance.select({
        total: count(),
        active: sql<number>`COALESCE(count(*) filter (where ${monitors.enabled} = true), 0)`,
        up: sql<number>`COALESCE(count(*) filter (where ${monitors.status} = 'up'), 0)`,
        down: sql<number>`COALESCE(count(*) filter (where ${monitors.status} = 'down'), 0)`,
      }).from(monitors)
        .where(monitorBaseCondition),
      
      // Recent monitor results (last 24h) - only for monitors in this project
      dbInstance.select({ count: count() })
        .from(monitorResults)
        .innerJoin(monitors, eq(monitorResults.monitorId, monitors.id))
        .where(and(
          gte(monitorResults.checkedAt, last24Hours),
          eq(monitors.projectId, targetProjectId),
          eq(monitors.organizationId, context.organizationId)
        )),
      
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
        .where(and(eq(monitors.status, "down"), eq(monitors.projectId, targetProjectId), eq(monitors.organizationId, context.organizationId)))
        .limit(5)
    ]);

    // Job Statistics - scoped to project
    // OPTIMIZED: Consolidated count queries using PostgreSQL FILTER clause
    const jobBaseCondition = and(
      eq(jobs.projectId, targetProjectId),
      eq(jobs.organizationId, context.organizationId)
    );
    
    const [
      jobCounts,
      recentRuns,
      runCounts24h,
      jobsByStatus,
      recentJobRuns,
      executionTimeData
    ] = await Promise.all([
      // OPTIMIZED: Single query for total and active job counts
      dbInstance.select({
        total: count(),
        active: sql<number>`count(*) filter (where ${jobs.status} = 'running')`,
      }).from(jobs)
        .where(jobBaseCondition),
      
      // Recent runs (last 30 days) - only for jobs in this project
      dbInstance.select({ count: count() })
        .from(runs)
        .innerJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last30Days),
          eq(jobs.projectId, targetProjectId),
          eq(jobs.organizationId, context.organizationId)
        )),
      
      // OPTIMIZED: Single query for successful and failed runs in last 24h
      dbInstance.select({
        total: count(),
        passed: sql<number>`count(*) filter (where ${runs.status} = 'passed')`,
        failed: sql<number>`count(*) filter (where ${runs.status} = 'failed')`,
      })
        .from(runs)
        .innerJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last24Hours),
          eq(jobs.projectId, targetProjectId),
          eq(jobs.organizationId, context.organizationId)
        )),
      
      // Jobs by status
      dbInstance.select({
        status: jobs.status,
        count: count()
      }).from(jobs)
        .where(jobBaseCondition)
        .groupBy(jobs.status),
      
      // Recent job runs with details (last 30 days for chart data)
      // Last 30 days only - already limited by time filter
      dbInstance.select({
        id: runs.id,
        jobId: runs.jobId,
        jobName: jobs.name,
        status: runs.status,
        startedAt: runs.startedAt,
        durationMs: runs.durationMs,
        trigger: runs.trigger
      }).from(runs)
        .leftJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last30Days),
          eq(jobs.projectId, targetProjectId),
          eq(jobs.organizationId, context.organizationId)
        ))
        .orderBy(desc(runs.startedAt)),
      
      // OPTIMIZED: Total execution time using SQL aggregation instead of fetching all rows
      // Now returns aggregated stats directly rather than raw data
      dbInstance.select({
        totalMs: sql<number>`COALESCE(SUM(${runs.durationMs}), 0)`,
        avgMs: sql<number>`COALESCE(AVG(${runs.durationMs}), 0)`,
        count: count(),
      }).from(runs)
        .leftJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last30Days),
          eq(jobs.projectId, targetProjectId), 
          eq(jobs.organizationId, context.organizationId),
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
      k6Stats
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
        totalVuMinutes: sql<number>`SUM(COALESCE(${k6PerformanceRuns.vusMax}, 1) * COALESCE(${k6PerformanceRuns.durationMs}, 0) / 60000.0)`,
        totalRequests: sum(k6PerformanceRuns.totalRequests),
        avgResponseTimeMs: sql<number>`AVG(${k6PerformanceRuns.avgResponseTimeMs})`
      }).from(k6PerformanceRuns)
        .where(and(
          gte(k6PerformanceRuns.startedAt, last30Days),
          eq(k6PerformanceRuns.projectId, targetProjectId),
          eq(k6PerformanceRuns.organizationId, context.organizationId),
          sql`${k6PerformanceRuns.completedAt} IS NOT NULL`
        ))
    ]);

    const [
      monitorExecutionAggregated,
      playgroundExecutionAggregated
    ] = await Promise.all([
      // OPTIMIZED: Synthetic monitor executions - SQL aggregation instead of fetching all rows
      // This was causing CPU spikes by fetching 4000+ rows and looping in JS
      dbInstance.select({
        totalResponseTimeMs: sql<number>`COALESCE(SUM(${monitorResults.responseTimeMs}), 0)`,
        count: count(),
        validCount: sql<number>`COUNT(*) FILTER (WHERE ${monitorResults.responseTimeMs} IS NOT NULL AND ${monitorResults.responseTimeMs} >= 0 AND ${monitorResults.responseTimeMs} <= 86400000)`
      }).from(monitorResults)
        .innerJoin(monitors, eq(monitorResults.monitorId, monitors.id))
        .where(and(
          gte(monitorResults.checkedAt, last30Days),
          eq(monitors.projectId, targetProjectId),
          eq(monitors.organizationId, context.organizationId),
          eq(monitors.type, 'synthetic_test')
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
        ), 0)`,
        validCount: sql<number>`COUNT(*) FILTER (WHERE ${reports.status} != 'running' AND ${reports.createdAt} IS NOT NULL AND ${reports.updatedAt} IS NOT NULL)`
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
        ))
    ]);

    // OPTIMIZED: Calculate uptime percentage using SQL aggregation instead of fetching all rows
    const uptimeResult = await dbInstance.select({
      totalChecks: count(),
      successfulChecks: sql<number>`count(*) filter (where ${monitorResults.isUp} = true)`,
    }).from(monitorResults)
      .innerJoin(monitors, eq(monitorResults.monitorId, monitors.id))
      .where(and(
        gte(monitorResults.checkedAt, last24Hours),
        eq(monitors.projectId, targetProjectId),
        eq(monitors.organizationId, context.organizationId)
      ));

    // Calculate overall uptime percentage from aggregated result
    const totalChecks = uptimeResult[0]?.totalChecks ?? 0;
    const successfulChecks = uptimeResult[0]?.successfulChecks ?? 0;
    const overallUptime = totalChecks > 0 ? (successfulChecks / totalChecks) * 100 : 100;

    // Monitor availability trend (last 30 days) - only for monitors in this project
    const availabilityTrend = await dbInstance.select({
      date: sql<string>`DATE(${monitorResults.checkedAt})`,
      upCount: sql<number>`SUM(CASE WHEN ${monitorResults.isUp} THEN 1 ELSE 0 END)`,
      totalCount: count()
    }).from(monitorResults)
      .innerJoin(monitors, eq(monitorResults.monitorId, monitors.id))
      .where(and(
        gte(monitorResults.checkedAt, last30Days),
        eq(monitors.projectId, targetProjectId),
        eq(monitors.organizationId, context.organizationId)
      ))
      .groupBy(sql`DATE(${monitorResults.checkedAt})`)
      .orderBy(sql`DATE(${monitorResults.checkedAt})`);

    // Response time statistics - only for monitors in this project
    const responseTimeStats = await dbInstance.select({
      avgResponseTime: sql<number>`AVG(${monitorResults.responseTimeMs})`,
      minResponseTime: sql<number>`MIN(${monitorResults.responseTimeMs})`,
      maxResponseTime: sql<number>`MAX(${monitorResults.responseTimeMs})`
    }).from(monitorResults)
      .innerJoin(monitors, eq(monitorResults.monitorId, monitors.id))
      .where(and(
        gte(monitorResults.checkedAt, last24Hours),
        eq(monitorResults.isUp, true),
        eq(monitors.projectId, targetProjectId),
        eq(monitors.organizationId, context.organizationId)
      ));

    // Daily playground executions breakdown (last 30 days)
    const playgroundExecutionsTrend = await dbInstance.select({
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
      .orderBy(sql`DATE(${auditLogs.createdAt})`);

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
        uptime: Math.round(overallUptime * 100) / 100,
        recentChecks24h: recentMonitorResults[0].count,
        byType: monitorsByType,
        criticalAlerts: criticalAlerts,
        availabilityTrend: availabilityTrend.map(day => ({
          date: day.date,
          uptime: day.totalCount > 0 ? Math.round((day.upCount / day.totalCount) * 100 * 100) / 100 : 100
        })),
        responseTime: {
          avg: responseTimeStats[0]?.avgResponseTime ? Math.round(responseTimeStats[0].avgResponseTime) : null,
          min: responseTimeStats[0]?.minResponseTime || null,
          max: responseTimeStats[0]?.maxResponseTime || null
        }
      },
      
      // Job Statistics
      jobs: {
        total: jobCounts[0].total,
        active: jobCounts[0].active,
        recentRuns30d: recentRuns[0].count,
        successfulRuns24h: runCounts24h[0].passed,
        failedRuns24h: runCounts24h[0].failed,
        byStatus: jobsByStatus,
        recentRuns: recentJobRuns.map(run => ({
          id: run.id,
          jobId: run.jobId,
          jobName: run.jobName,
          status: run.status,
          startedAt: run.startedAt?.toISOString(),
          durationMs: run.durationMs,
          trigger: run.trigger
        })),
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

      // System Health
      system: {
        timestamp: now.toISOString(),
        healthy: monitorCounts[0].down === 0 && queueStats.running < queueStats.runningCapacity
      }
    });

    // Enable short-term caching (30s) to reduce CPU load from repeated dashboard requests
    // Project context is per-request so different projects get different cached responses
    response.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    
    return response;

  } catch (error) {
    // Log error for debugging but avoid logging sensitive data
    console.error("Dashboard API error:", error instanceof Error ? error.message : 'Unknown error');
    
    // Return generic error message to avoid information disclosure
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
} 
