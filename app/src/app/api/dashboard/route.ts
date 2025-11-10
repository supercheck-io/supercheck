import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { monitors, monitorResults, jobs, runs, tests, auditLogs, reports } from "@/db/schema";
import { eq, desc, gte, and, count, sql } from "drizzle-orm";
import { subDays, subHours } from "date-fns";
import { getQueueStats } from "@/lib/queue-stats";
import { hasPermission } from '@/lib/rbac/middleware';
import { requireProjectContext } from '@/lib/project-context';
import { buildProjectObservabilitySnapshot } from "~/lib/observability/analytics";

export async function GET() {
  try {
    const { project, organizationId } = await requireProjectContext();
    
    // Use current project context - no need for query params
    const targetProjectId = project.id;
    
    // Build permission context and check access
    const canView = await hasPermission('project', 'view', { organizationId, projectId: targetProjectId });
    
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
    const [
      totalMonitors,
      activeMonitors,
      upMonitors,
      downMonitors,
      recentMonitorResults,
      monitorsByType,
      criticalAlerts
    ] = await Promise.all([
      // Total monitors
      dbInstance.select({ count: count() }).from(monitors)
        .where(and(eq(monitors.projectId, targetProjectId), eq(monitors.organizationId, organizationId))),
      
      // Active (enabled) monitors
      dbInstance.select({ count: count() }).from(monitors)
        .where(and(eq(monitors.enabled, true), eq(monitors.projectId, targetProjectId), eq(monitors.organizationId, organizationId))),
      
      // Up monitors (based on latest status)
      dbInstance.select({ count: count() }).from(monitors)
        .where(and(eq(monitors.status, "up"), eq(monitors.projectId, targetProjectId), eq(monitors.organizationId, organizationId))),
      
      // Down monitors
      dbInstance.select({ count: count() }).from(monitors)
        .where(and(eq(monitors.status, "down"), eq(monitors.projectId, targetProjectId), eq(monitors.organizationId, organizationId))),
      
      // Recent monitor results (last 24h) - only for monitors in this project
      dbInstance.select({ count: count() })
        .from(monitorResults)
        .innerJoin(monitors, eq(monitorResults.monitorId, monitors.id))
        .where(and(
          gte(monitorResults.checkedAt, last24Hours),
          eq(monitors.projectId, targetProjectId),
          eq(monitors.organizationId, organizationId)
        )),
      
      // Monitor count by type
      dbInstance.select({
        type: monitors.type,
        count: count()
      }).from(monitors)
        .where(and(eq(monitors.projectId, targetProjectId), eq(monitors.organizationId, organizationId)))
        .groupBy(monitors.type),
      
      // Critical alerts (down monitors)
      dbInstance.select({
        id: monitors.id,
        name: monitors.name,
        type: monitors.type,
        status: monitors.status,
        lastCheckAt: monitors.lastCheckAt
      }).from(monitors)
        .where(and(eq(monitors.status, "down"), eq(monitors.projectId, targetProjectId), eq(monitors.organizationId, organizationId)))
        .limit(5)
    ]);

    // Job Statistics - scoped to project
    const [
      totalJobs,
      activeJobs,
      recentRuns,
      successfulRuns24h,
      failedRuns24h,
      jobsByStatus,
      recentJobRuns,
      executionTimeData
    ] = await Promise.all([
      // Total jobs
      dbInstance.select({ count: count() }).from(jobs)
        .where(and(eq(jobs.projectId, targetProjectId), eq(jobs.organizationId, organizationId))),
      
      // Active jobs (not paused)
      dbInstance.select({ count: count() }).from(jobs)
        .where(and(eq(jobs.status, "running"), eq(jobs.projectId, targetProjectId), eq(jobs.organizationId, organizationId))),
      
      // Recent runs (last 30 days) - only for jobs in this project
      dbInstance.select({ count: count() })
        .from(runs)
        .innerJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last30Days),
          eq(jobs.projectId, targetProjectId),
          eq(jobs.organizationId, organizationId)
        )),
      
      // Successful runs in last 24h
      dbInstance.select({ count: count() })
        .from(runs)
        .innerJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last24Hours),
          eq(runs.status, "passed"),
          eq(jobs.projectId, targetProjectId),
          eq(jobs.organizationId, organizationId)
        )),
      
      // Failed runs in last 24h
      dbInstance.select({ count: count() })
        .from(runs)
        .innerJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last24Hours),
          eq(runs.status, "failed"),
          eq(jobs.projectId, targetProjectId),
          eq(jobs.organizationId, organizationId)
        )),
      
      // Jobs by status
      dbInstance.select({
        status: jobs.status,
        count: count()
      }).from(jobs)
        .where(and(eq(jobs.projectId, targetProjectId), eq(jobs.organizationId, organizationId)))
        .groupBy(jobs.status),
      
      // Recent job runs with details (last 30 days for chart data)
      // Last 30 days only - already limited by time filter
      dbInstance.select({
        id: runs.id,
        jobId: runs.jobId,
        jobName: jobs.name,
        status: runs.status,
        startedAt: runs.startedAt,
        duration: runs.duration,
        trigger: runs.trigger
      }).from(runs)
        .leftJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last30Days),
          eq(jobs.projectId, targetProjectId),
          eq(jobs.organizationId, organizationId)
        ))
        .orderBy(desc(runs.startedAt)),
      
      // Total execution time (last 30 days) 
      dbInstance.select({
        duration: runs.duration,
        durationMs: runs.durationMs,
        status: runs.status,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt
      }).from(runs)
        .leftJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last30Days),
          eq(jobs.projectId, targetProjectId), 
          eq(jobs.organizationId, organizationId),
          // Only include completed runs
          sql`${runs.completedAt} IS NOT NULL`
        ))
        .orderBy(desc(runs.startedAt))
    ]);

    // Test Statistics - scoped to project
    const [
      totalTests,
      testsByType,
      playgroundExecutions30d
    ] = await Promise.all([
      // Total tests
      dbInstance.select({ count: count() }).from(tests)
        .where(and(eq(tests.projectId, targetProjectId), eq(tests.organizationId, organizationId))),
      
      // Tests by type
      dbInstance.select({
        type: tests.type,
        count: count()
      }).from(tests)
        .where(and(eq(tests.projectId, targetProjectId), eq(tests.organizationId, organizationId)))
        .groupBy(tests.type),
      
      // Playground test executions (last 30 days) from audit logs
      dbInstance.select({ count: count() })
        .from(auditLogs)
        .where(and(
          eq(auditLogs.action, 'playground_test_executed'),
          eq(auditLogs.organizationId, organizationId),
          gte(auditLogs.createdAt, last30Days),
          sql`${auditLogs.details}->'metadata'->>'projectId' = ${targetProjectId}`
        ))
    ]);

    const [
      monitorExecutionData,
      playgroundExecutionReports
    ] = await Promise.all([
      // Synthetic monitor executions (Playwright-based) in last 30 days
      dbInstance.select({
        monitorId: monitorResults.monitorId,
        responseTimeMs: monitorResults.responseTimeMs,
        checkedAt: monitorResults.checkedAt,
        location: monitorResults.location,
        status: monitorResults.status
      }).from(monitorResults)
        .innerJoin(monitors, eq(monitorResults.monitorId, monitors.id))
        .where(and(
          gte(monitorResults.checkedAt, last30Days),
          eq(monitors.projectId, targetProjectId),
          eq(monitors.organizationId, organizationId),
          eq(monitors.type, 'synthetic_test')
        )),

      // Playground test executions matched with their report metadata
      dbInstance.select({
        reportEntityId: reports.entityId,
        reportStatus: reports.status,
        reportCreatedAt: reports.createdAt,
        reportUpdatedAt: reports.updatedAt,
        auditCreatedAt: auditLogs.createdAt
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
          eq(auditLogs.organizationId, organizationId),
          gte(auditLogs.createdAt, last30Days),
          sql`${auditLogs.details}->'metadata'->>'projectId' = ${targetProjectId}`
        ))
    ]);

    // Calculate uptime percentage for active monitors in this project
    const uptimeStats = await dbInstance.select({
      monitorId: monitorResults.monitorId,
      isUp: monitorResults.isUp,
      checkedAt: monitorResults.checkedAt
    }).from(monitorResults)
      .innerJoin(monitors, eq(monitorResults.monitorId, monitors.id))
      .where(and(
        gte(monitorResults.checkedAt, last24Hours),
        eq(monitors.projectId, targetProjectId),
        eq(monitors.organizationId, organizationId)
      ))
      .orderBy(desc(monitorResults.checkedAt));

    // Calculate overall uptime percentage
    const totalChecks = uptimeStats.length;
    const successfulChecks = uptimeStats.filter(r => r.isUp).length;
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
        eq(monitors.organizationId, organizationId)
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
        eq(monitors.organizationId, organizationId)
      ));

    // Daily playground executions breakdown (last 30 days)
    const playgroundExecutionsTrend = await dbInstance.select({
      date: sql<string>`DATE(${auditLogs.createdAt})`,
      count: count()
    }).from(auditLogs)
      .where(and(
        eq(auditLogs.action, 'playground_test_executed'),
        eq(auditLogs.organizationId, organizationId),
        gte(auditLogs.createdAt, last30Days),
        sql`${auditLogs.details}->'metadata'->>'projectId' = ${targetProjectId}`
      ))
      .groupBy(sql`DATE(${auditLogs.createdAt})`)
      .orderBy(sql`DATE(${auditLogs.createdAt})`);

    const observabilitySnapshot = await buildProjectObservabilitySnapshot({
      projectId: targetProjectId,
      organizationId,
      lookbackMinutes: 60,
    });

    // Calculate total execution time with accuracy
    const totalExecutionTimeCalculation = (() => {
      const errors: string[] = [];

      const jobAggregate = {
        totalMs: 0,
        processed: 0,
        skipped: 0,
        totalRecords: executionTimeData.length
      };

      for (const run of executionTimeData) {
        try {
          let durationMs: number | null = null;

          // Prefer explicit millisecond duration when available
          if (run.durationMs !== null && run.durationMs !== undefined) {
            const numericDuration = Number(run.durationMs);
            if (!Number.isFinite(numericDuration)) {
              errors.push(`DurationMs not numeric: ${run.durationMs}`);
              jobAggregate.skipped++;
              continue;
            }
            durationMs = numericDuration;
          } else if (run.duration) {
            // Parse duration string - handle different formats robustly
            const durationStr = run.duration.toString().trim();

            if (durationStr.endsWith("ms")) {
              durationMs = parseInt(durationStr.replace("ms", ""), 10);
            } else if (durationStr.endsWith("s")) {
              const seconds = parseInt(durationStr.replace("s", ""), 10);
              durationMs = Number.isNaN(seconds) ? null : seconds * 1000;
            } else if (/^\d+$/.test(durationStr)) {
              const seconds = parseInt(durationStr, 10);
              durationMs = Number.isNaN(seconds) ? null : seconds * 1000;
            } else {
              const parsed = parseInt(durationStr, 10);
              durationMs = Number.isNaN(parsed) ? null : parsed;
            }
          } else if (run.startedAt && run.completedAt) {
            // Fallback to timestamps when provided
            const startedAt =
              run.startedAt instanceof Date ? run.startedAt : new Date(run.startedAt);
            const completedAt =
              run.completedAt instanceof Date ? run.completedAt : new Date(run.completedAt);

            if (!Number.isNaN(startedAt.getTime()) && !Number.isNaN(completedAt.getTime())) {
              durationMs = completedAt.getTime() - startedAt.getTime();
            }
          }

          if (durationMs === null) {
            errors.push(
              `Unable to determine duration for run starting ${run.startedAt?.toString() ?? "unknown"}`
            );
            jobAggregate.skipped++;
            continue;
          }

          if (!Number.isFinite(durationMs)) {
            errors.push(
              `Duration not finite for run starting ${run.startedAt?.toString() ?? "unknown"}`
            );
            jobAggregate.skipped++;
            continue;
          }

          // Validate duration is reasonable (0ms to 24 hours max)
          if (durationMs < 0 || durationMs > 24 * 60 * 60 * 1000) {
            errors.push(`Duration out of range: ${durationMs}ms`);
            jobAggregate.skipped++;
            continue;
          }

          jobAggregate.totalMs += durationMs;
          jobAggregate.processed++;

        } catch (error) {
          errors.push(`Error processing run ${run.startedAt}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          jobAggregate.skipped++;
        }
      }

      const monitorAggregate = {
        totalMs: 0,
        processed: 0,
        skipped: 0,
        totalRecords: monitorExecutionData.length
      };

      for (const monitorRun of monitorExecutionData) {
        try {
          if (monitorRun.responseTimeMs === null || monitorRun.responseTimeMs === undefined) {
            monitorAggregate.skipped++;
            continue;
          }

          const responseTime = Number(monitorRun.responseTimeMs);
          if (!Number.isFinite(responseTime)) {
            errors.push(`Monitor response time not numeric for monitor ${monitorRun.monitorId}`);
            monitorAggregate.skipped++;
            continue;
          }

          if (responseTime < 0 || responseTime > 24 * 60 * 60 * 1000) {
            errors.push(`Monitor response time out of range (${responseTime}ms) for monitor ${monitorRun.monitorId}`);
            monitorAggregate.skipped++;
            continue;
          }

          monitorAggregate.totalMs += responseTime;
          monitorAggregate.processed++;
        } catch (error) {
          errors.push(`Error processing monitor execution ${monitorRun.monitorId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          monitorAggregate.skipped++;
        }
      }

      const playgroundAggregate = {
        totalMs: 0,
        processed: 0,
        skipped: 0,
        totalRecords: playgroundExecutionReports.length
      };

      for (const report of playgroundExecutionReports) {
        try {
          if (!report.reportCreatedAt || !report.reportUpdatedAt) {
            playgroundAggregate.skipped++;
            continue;
          }

          if (report.reportStatus === 'running') {
            // Execution still in progress - skip from aggregation
            playgroundAggregate.skipped++;
            continue;
          }

          const createdAtDate =
            report.reportCreatedAt instanceof Date
              ? report.reportCreatedAt
              : new Date(report.reportCreatedAt);
          const updatedAtDate =
            report.reportUpdatedAt instanceof Date
              ? report.reportUpdatedAt
              : new Date(report.reportUpdatedAt);

          if (Number.isNaN(createdAtDate.getTime()) || Number.isNaN(updatedAtDate.getTime())) {
            errors.push(`Playground execution timestamps invalid for report ${report.reportEntityId}`);
            playgroundAggregate.skipped++;
            continue;
          }

          const createdAtMs = createdAtDate.getTime();
          const updatedAtMs = updatedAtDate.getTime();
          const durationMs = updatedAtMs - createdAtMs;

          if (!Number.isFinite(durationMs) || durationMs < 0) {
            errors.push(`Playground execution duration invalid for report ${report.reportEntityId}`);
            playgroundAggregate.skipped++;
            continue;
          }

          if (durationMs > 24 * 60 * 60 * 1000) {
            errors.push(`Playground execution duration out of range (${durationMs}ms) for report ${report.reportEntityId}`);
            playgroundAggregate.skipped++;
            continue;
          }

          playgroundAggregate.totalMs += durationMs;
          playgroundAggregate.processed++;
        } catch (error) {
          errors.push(`Error processing playground execution ${report.reportEntityId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          playgroundAggregate.skipped++;
        }
      }

      const totalMs = jobAggregate.totalMs + monitorAggregate.totalMs + playgroundAggregate.totalMs;
      const processedRuns = jobAggregate.processed + monitorAggregate.processed + playgroundAggregate.processed;
      const skippedRuns = jobAggregate.skipped + monitorAggregate.skipped + playgroundAggregate.skipped;

      // Log Exec time calculation details
      const execTimeAuditData = {
        projectId: targetProjectId,
        organizationId,
        timestamp: new Date().toISOString(),
        totalExecutionTimeMs: totalMs,
        totalExecutionTimeMinutes: Math.round(totalMs / 60000 * 100) / 100,
        totalExecutionTimeSeconds: Math.floor(totalMs / 1000),
        processedRuns,
        skippedRuns,
        totalRuns: jobAggregate.totalRecords + monitorAggregate.totalRecords + playgroundAggregate.totalRecords,
        errorCount: errors.length,
        period: 'last 30 days (UTC)',
        queryStartTime: last30Days.toISOString(),
        queryEndTime: now.toISOString(),
        calculationMethod: 'multi_source_aggregation',
        sources: {
          jobs: jobAggregate,
          monitors: monitorAggregate,
          playground: playgroundAggregate
        },
        dataIntegrity: {
          hasNegativeDurations: false,
          hasExcessiveDurations: false,
          completedRunsOnly: true
        }
      };

      // Structured logging for execution time audit
      console.log(`[EXECUTION_TIME_AUDIT] ${JSON.stringify(execTimeAuditData)}`);

      if (errors.length > 0) {
        console.warn(`[EXECUTION_TIME] Calculation errors:`, errors);
      }

      return {
        totalMs,
        totalSeconds: Math.floor(totalMs / 1000),
        totalMinutes: Math.round(totalMs / 60000 * 100) / 100, // 2 decimal places
        processedRuns,
        skippedRuns,
        errors: errors.length
      };
    })();

    const response = NextResponse.json({
      // Queue Statistics
      queue: queueStats,
      
      // Monitor Statistics
      monitors: {
        total: totalMonitors[0].count,
        active: activeMonitors[0].count,
        up: upMonitors[0].count,
        down: downMonitors[0].count,
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
        total: totalJobs[0].count,
        active: activeJobs[0].count,
        recentRuns30d: recentRuns[0].count,
        successfulRuns24h: successfulRuns24h[0].count,
        failedRuns24h: failedRuns24h[0].count,
        byStatus: jobsByStatus,
        recentRuns: recentJobRuns.map(run => ({
          id: run.id,
          jobId: run.jobId,
          jobName: run.jobName,
          status: run.status,
          startedAt: run.startedAt?.toISOString(),
          duration: run.duration,
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

      observability: observabilitySnapshot,
      
      // System Health
      system: {
        timestamp: now.toISOString(),
        healthy: downMonitors[0].count === 0 && queueStats.running < queueStats.runningCapacity
      }
    });

    // Disable caching to ensure fresh data after project switches
    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    
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
