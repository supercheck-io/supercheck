/**
 * Dashboard Data Hook
 * 
 * React Query hook for fetching dashboard data with efficient caching.
 * Data is cached for 60 seconds to prevent re-fetches on navigation.
 * No auto-refresh - data refreshes on page visit or manual action.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useProjectContext } from "./use-project-context";

// ============================================================================
// TYPES (imported from dashboard page to ensure type consistency)
// ============================================================================

interface ProjectStats {
  tests: number;
  jobs: number;
  monitors: number;
  runs: number;
}

interface MonitorSummary {
  total: number;
  active: number;
  up: number;
  down: number;
  uptime: number;
  criticalAlerts: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    lastCheckAt: string | null;
  }>;
  byType: Array<{ type: string; count: number }>;
  responseTime: {
    avg: number | null;
    min: number | null;
    max: number | null;
  };
  availabilityTrend?: Array<{
    date: string;
    uptime: number;
  }>;
}

interface JobSummary {
  total: number;
  successfulRuns24h: number;
  failedRuns24h: number;
  recentRuns: Array<{
    id: string;
    jobId: string;
    jobName: string;
    status: string;
    startedAt: string;
    duration: string;
    trigger: string;
  }>;
  executionTime: {
    totalMs: number;
    totalSeconds: number;
    totalMinutes: number;
    processedRuns: number;
    skippedRuns: number;
    errors: number;
    period: string;
  };
}

interface TestSummary {
  total: number;
  byType: Array<{ type: string; count: number }>;
  playgroundExecutions30d: number;
  playgroundExecutionsTrend: Array<{ date: string; count: number }>;
}

interface K6Summary {
  totalRuns: number;
  totalDurationMs: number;
  totalDurationMinutes: number;
  totalVuMinutes: number;
  totalRequests: number;
  avgResponseTimeMs: number;
  period: string;
}

interface AlertHistoryItem {
  id: string;
  targetType: string;
  targetName: string;
  type: string;
  message: string;
  status: string;
  timestamp: string;
  notificationProvider: string;
}

interface SystemHealth {
  timestamp: string;
  healthy: boolean;
  issues: Array<{
    type: "monitor" | "job" | "queue";
    message: string;
    severity: "low" | "medium" | "high" | "critical";
  }>;
}

export interface DashboardData {
  stats: ProjectStats;
  monitors: MonitorSummary;
  jobs: JobSummary;
  tests: TestSummary;
  k6: K6Summary;
  alerts: AlertHistoryItem[];
  system: SystemHealth;
}

// ============================================================================
// QUERY KEY
// ============================================================================

export const DASHBOARD_QUERY_KEY = ["dashboard"] as const;

// Helper to create project-scoped key
export const getDashboardQueryKey = (projectId: string | null) => 
  [...DASHBOARD_QUERY_KEY, projectId] as const;

// ============================================================================
// FETCH FUNCTION (exported for prefetching)
// ============================================================================

export async function fetchDashboard(): Promise<DashboardData> {
  const controller = new AbortController();
  // Increased timeout to 30s for cold starts when database connections are warming up
  const timeoutId = setTimeout(() => controller.abort('Dashboard request timeout'), 30000);

  try {
    const [dashboardResponse, alertsResponse] = await Promise.all([
      fetch(`/api/dashboard?t=${Date.now()}`, {
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
      }),
      fetch("/api/alerts/history", {
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
      }),
    ]);

    clearTimeout(timeoutId);

    if (!dashboardResponse.ok) {
      throw new Error(
        `Dashboard API error: ${dashboardResponse.status} ${dashboardResponse.statusText}`
      );
    }

    const data = await dashboardResponse.json();
    const alertsData = alertsResponse.ok ? await alertsResponse.json() : [];

    // Transform and validate data (same logic as original)
    return transformDashboardData(data, alertsData);
  } catch (error) {
    clearTimeout(timeoutId);
    // Provide more descriptive error message for abort
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Dashboard request timed out. Please try again.');
    }
    throw error;
  }
}

// ============================================================================
// DATA TRANSFORMATION (moved from page.tsx for reusability)
// ============================================================================

const LOOKBACK_DAYS = 30;

function transformDashboardData(data: Record<string, unknown>, alertsData: unknown[]): DashboardData {
  // Analyze system health
  const systemIssues: SystemHealth["issues"] = [];

  const monitorsDown = Number(data.monitors && typeof data.monitors === 'object' ? (data.monitors as Record<string, unknown>).down : 0) || 0;
  if (monitorsDown > 0) {
    systemIssues.push({
      type: "monitor" as const,
      message: `${monitorsDown} monitor${monitorsDown === 1 ? "" : "s"} ${monitorsDown === 1 ? "is" : "are"} down`,
      severity: monitorsDown > 2 ? ("critical" as const) : ("high" as const),
    });
  }

  const jobsData = data.jobs as Record<string, unknown> | undefined;
  const failedJobs = Number(jobsData?.failedRuns24h) || 0;
  if (failedJobs > 0) {
    systemIssues.push({
      type: "job" as const,
      message: `${failedJobs} job${failedJobs === 1 ? "" : "s"} failed in the last 24 hours`,
      severity: failedJobs > 5 ? ("high" as const) : ("medium" as const),
    });
  }

  // Queue capacity checks removed as per user request
  // Only showing Monitor and Job issues derived from specific failure counts

  const monitorsData = data.monitors as Record<string, unknown> | undefined;
  const testsData = data.tests as Record<string, unknown> | undefined;
  const k6Data = data.k6 as Record<string, unknown> | undefined;

  return {
    stats: {
      tests: Math.max(0, Number(testsData?.total) || 0),
      jobs: Math.max(0, Number(jobsData?.total) || 0),
      monitors: Math.max(0, Number(monitorsData?.total) || 0),
      runs: Math.max(0, Number(jobsData?.recentRuns30d) || 0),
    },
    monitors: {
      total: Math.max(0, Number(monitorsData?.total) || 0),
      active: Math.max(0, Number(monitorsData?.active) || 0),
      up: Math.max(0, Number(monitorsData?.up) || 0),
      down: Math.max(0, Number(monitorsData?.down) || 0),
      uptime: Math.max(0, Math.min(100, Number(monitorsData?.uptime) || 0)),
      criticalAlerts: Array.isArray(monitorsData?.criticalAlerts)
        ? (monitorsData.criticalAlerts as Array<Record<string, unknown>>).slice(0, 100).map(alert => ({
            id: String(alert.id || ''),
            name: String(alert.name || ''),
            type: String(alert.type || ''),
            status: String(alert.status || ''),
            lastCheckAt: alert.lastCheckAt ? String(alert.lastCheckAt) : null,
          }))
        : [],
      byType: Array.isArray(monitorsData?.byType)
        ? (monitorsData.byType as Array<Record<string, unknown>>).slice(0, 20).map(item => ({
            type: String(item.type || ''),
            count: Number(item.count) || 0,
          }))
        : [],
      responseTime: {
        avg: (monitorsData?.responseTime as Record<string, unknown>)?.avg !== null
          ? Number((monitorsData?.responseTime as Record<string, unknown>)?.avg) || null
          : null,
        min: (monitorsData?.responseTime as Record<string, unknown>)?.min !== null
          ? Number((monitorsData?.responseTime as Record<string, unknown>)?.min) || null
          : null,
        max: (monitorsData?.responseTime as Record<string, unknown>)?.max !== null
          ? Number((monitorsData?.responseTime as Record<string, unknown>)?.max) || null
          : null,
      },
      availabilityTrend: Array.isArray(monitorsData?.availabilityTrend)
        ? (monitorsData.availabilityTrend as Array<Record<string, unknown>>).slice(0, LOOKBACK_DAYS).map(item => ({
            date: String(item.date || ''),
            uptime: Number(item.uptime) || 0,
          }))
        : undefined,
    },
    jobs: {
      total: Math.max(0, Number(jobsData?.total) || 0),
      successfulRuns24h: Math.max(0, Number(jobsData?.successfulRuns24h) || 0),
      failedRuns24h: Math.max(0, Number(jobsData?.failedRuns24h) || 0),
      recentRuns: Array.isArray(jobsData?.recentRuns)
        ? (jobsData.recentRuns as Array<Record<string, unknown>>).slice(0, 1000).map(run => ({
            id: String(run.id || ''),
            jobId: String(run.jobId || ''),
            jobName: String(run.jobName || ''),
            status: String(run.status || ''),
            startedAt: String(run.startedAt || ''),
            duration: String(run.durationMs || ''),
            trigger: String(run.trigger || ''),
          }))
        : [],
      executionTime: {
        totalMs: Math.max(0, Number((jobsData?.executionTime as Record<string, unknown>)?.totalMs) || 0),
        totalSeconds: Math.max(0, Number((jobsData?.executionTime as Record<string, unknown>)?.totalSeconds) || 0),
        totalMinutes: Math.max(0, Number((jobsData?.executionTime as Record<string, unknown>)?.totalMinutes) || 0),
        processedRuns: Math.max(0, Number((jobsData?.executionTime as Record<string, unknown>)?.processedRuns) || 0),
        skippedRuns: Math.max(0, Number((jobsData?.executionTime as Record<string, unknown>)?.skippedRuns) || 0),
        errors: Math.max(0, Number((jobsData?.executionTime as Record<string, unknown>)?.errors) || 0),
        period: String((jobsData?.executionTime as Record<string, unknown>)?.period || "last 30 days"),
      },
    },
    tests: {
      total: Math.max(0, Number(testsData?.total) || 0),
      byType: Array.isArray(testsData?.byType)
        ? (testsData.byType as Array<Record<string, unknown>>).slice(0, 20).map(item => ({
            type: String(item.type || ''),
            count: Number(item.count) || 0,
          }))
        : [],
      playgroundExecutions30d: Math.max(0, Number(testsData?.playgroundExecutions30d) || 0),
      playgroundExecutionsTrend: Array.isArray(testsData?.playgroundExecutionsTrend)
        ? (testsData.playgroundExecutionsTrend as Array<Record<string, unknown>>).slice(0, LOOKBACK_DAYS).map(item => ({
            date: String(item.date || ''),
            count: Number(item.count) || 0,
          }))
        : [],
    },
    k6: {
      totalRuns: Math.max(0, Number(k6Data?.totalRuns) || 0),
      totalDurationMs: Math.max(0, Number(k6Data?.totalDurationMs) || 0),
      totalDurationMinutes: Math.max(0, Number(k6Data?.totalDurationMinutes) || 0),
      totalVuMinutes: Math.max(0, Number(k6Data?.totalVuMinutes) || 0),
      totalRequests: Math.max(0, Number(k6Data?.totalRequests) || 0),
      avgResponseTimeMs: Math.max(0, Number(k6Data?.avgResponseTimeMs) || 0),
      period: String(k6Data?.period || "last 30 days"),
    },
    alerts: Array.isArray(alertsData) 
      ? alertsData.slice(0, 10).map((alert: unknown) => {
          const a = alert as Record<string, unknown>;
          return {
            id: String(a.id || ''),
            targetType: String(a.targetType || ''),
            targetName: String(a.targetName || ''),
            type: String(a.type || ''),
            message: String(a.message || ''),
            status: String(a.status || ''),
            timestamp: String(a.timestamp || ''),
            notificationProvider: String(a.notificationProvider || ''),
          };
        })
      : [],
    system: {
      timestamp: new Date().toISOString(),
      healthy: systemIssues.length === 0,
      issues: systemIssues,
    },
  };
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to fetch dashboard data with React Query caching.
 * 
 * Benefits:
 * - Cached across navigations (no re-fetch when returning to dashboard)
 * - Automatic background refresh every 60 seconds
 * - Request deduplication if multiple components need same data
 * - Project switch invalidates cache automatically via queryKey
 */
export function useDashboard() {
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: getDashboardQueryKey(projectId),
    queryFn: fetchDashboard,
    enabled: !!projectId, // Only fetch when we have a project
    // PERFORMANCE: No polling - data refreshes on page visit or manual refresh
    // Dashboard makes 25+ DB queries per request - polling is too expensive
    staleTime: 60 * 1000,  // 60 seconds
    gcTime: 10 * 60 * 1000,    // 10 minutes - keep in memory
    refetchOnWindowFocus: false,
    retry: 2,
  });

  // Function to manually refetch (e.g., after project switch)
  const refetch = () => query.refetch();

  // Function to invalidate cache (e.g., after data mutation)
  const invalidate = () => 
    queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY, refetchType: 'all' });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error as Error | null,
    refetch,
    invalidate,
  };
}
