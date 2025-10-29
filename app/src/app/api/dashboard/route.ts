import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { monitors, monitorResults, jobs, runs, tests, auditLogs } from "@/db/schema";
import { eq, desc, gte, and, count, sql } from "drizzle-orm";
import { subDays, subHours } from "date-fns";
import { getQueueStats } from "@/lib/queue-stats";
import { hasPermission } from '@/lib/rbac/middleware';
import { requireProjectContext } from '@/lib/project-context';

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
    const last7Days = subDays(now, 7);

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
      
      // Recent runs (last 7 days) - only for jobs in this project
      dbInstance.select({ count: count() })
        .from(runs)
        .innerJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last7Days),
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
      
      // Recent job runs with details (last 7 days for chart data)
      // Last 7 days only - already limited by time filter
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
          gte(runs.startedAt, last7Days),
          eq(jobs.projectId, targetProjectId),
          eq(jobs.organizationId, organizationId)
        ))
        .orderBy(desc(runs.startedAt)),
      
      // Total execution time (last 7 days) 
      dbInstance.select({
        duration: runs.duration,
        status: runs.status,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt
      }).from(runs)
        .leftJoin(jobs, eq(runs.jobId, jobs.id))
        .where(and(
          gte(runs.startedAt, last7Days),
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
      playgroundExecutions7d
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
      
      // Playground test executions (last 7 days) from audit logs
      dbInstance.select({ count: count() })
        .from(auditLogs)
        .where(and(
          eq(auditLogs.action, 'playground_test_executed'),
          eq(auditLogs.organizationId, organizationId),
          gte(auditLogs.createdAt, last7Days),
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

    // Monitor availability trend (last 7 days) - only for monitors in this project
    const availabilityTrend = await dbInstance.select({
      date: sql<string>`DATE(${monitorResults.checkedAt})`,
      upCount: sql<number>`SUM(CASE WHEN ${monitorResults.isUp} THEN 1 ELSE 0 END)`,
      totalCount: count()
    }).from(monitorResults)
      .innerJoin(monitors, eq(monitorResults.monitorId, monitors.id))
      .where(and(
        gte(monitorResults.checkedAt, last7Days),
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

    // Daily playground executions breakdown (last 7 days)
    const playgroundExecutionsTrend = await dbInstance.select({
      date: sql<string>`DATE(${auditLogs.createdAt})`,
      count: count()
    }).from(auditLogs)
      .where(and(
        eq(auditLogs.action, 'playground_test_executed'),
        eq(auditLogs.organizationId, organizationId),
        gte(auditLogs.createdAt, last7Days),
        sql`${auditLogs.details}->'metadata'->>'projectId' = ${targetProjectId}`
      ))
      .groupBy(sql`DATE(${auditLogs.createdAt})`)
      .orderBy(sql`DATE(${auditLogs.createdAt})`);

    // Calculate total execution time with accuracy
    const totalExecutionTimeCalculation = (() => {
      let totalMs = 0;
      let processedRuns = 0;
      let skippedRuns = 0;
      const errors: string[] = [];

      for (const run of executionTimeData) {
        try {
          // Skip runs without duration (incomplete or failed early)
          if (!run.duration) {
            skippedRuns++;
            continue;
          }

          // Parse duration - handle different formats robustly
          let durationMs = 0;
          const durationStr = run.duration.toString().trim();
          
          if (durationStr.includes('ms')) {
            // Format: "1234ms"
            durationMs = parseInt(durationStr.replace('ms', ''), 10);
          } else if (durationStr.includes('s')) {
            // Format: "123s" 
            const seconds = parseInt(durationStr.replace('s', ''), 10);
            durationMs = seconds * 1000;
          } else if (/^\d+$/.test(durationStr)) {
            // Format: "123" (assuming seconds based on worker code)
            const seconds = parseInt(durationStr, 10);
            durationMs = seconds * 1000;
          } else {
            // Try parsing as direct milliseconds
            durationMs = parseInt(durationStr, 10);
            if (isNaN(durationMs)) {
              errors.push(`Invalid duration format: ${durationStr}`);
              skippedRuns++;
              continue;
            }
          }

          // Validate duration is reasonable (0ms to 24 hours max)
          if (durationMs < 0 || durationMs > 24 * 60 * 60 * 1000) {
            errors.push(`Duration out of range: ${durationMs}ms`);
            skippedRuns++;
            continue;
          }

          totalMs += durationMs;
          processedRuns++;

        } catch (error) {
          errors.push(`Error processing run ${run.startedAt}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          skippedRuns++;
        }
      }

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
        totalRuns: executionTimeData.length,
        errorCount: errors.length,
        period: 'last 7 days (UTC)',
        queryStartTime: last7Days.toISOString(),
        queryEndTime: now.toISOString(),
        calculationMethod: 'duration_field_aggregation',
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
        recentRuns7d: recentRuns[0].count,
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
          period: 'last 7 days'
        }
      },
      
      // Test Statistics
      tests: {
        total: totalTests[0].count,
        byType: testsByType,
        playgroundExecutions7d: playgroundExecutions7d[0].count,
        playgroundExecutionsTrend: playgroundExecutionsTrend
      },
      
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