"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  Monitor,
  RefreshCw,
  Code,
  CalendarClock,
  Activity,
  TrendingUp,
  Home as HomeIcon,
  Clock,
  NotepadText
} from "lucide-react";
import { useEffect, useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveContainer, XAxis, YAxis, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, Area, AreaChart } from "recharts";
import Link from "next/link";

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
  playgroundExecutions7d: number;
  playgroundExecutionsTrend: Array<{ date: string; count: number }>;
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
    type: 'monitor' | 'job' | 'queue';
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
}

interface DashboardData {
  stats: ProjectStats;
  monitors: MonitorSummary;
  jobs: JobSummary;
  tests: TestSummary;
  alerts: AlertHistoryItem[];
  system: SystemHealth;
}

interface ChartDataPoint {
  day: string;
  date: string;
  [key: string]: string | number;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{
    color: string;
    name: string;
    value: number;
    dataKey: string;
    payload: ChartDataPoint;
  }>;
  label?: string;
}

// Custom tooltip component with theme-aware styling
const CustomTooltip: React.FC<TooltipProps> = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0]?.payload;
  
  return (
    <div className="bg-background/95 backdrop-blur-sm border border-border rounded-md shadow-lg px-3 py-2 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {data?.date && (
          <>
            <span className="text-xs text-muted-foreground">•</span>
            <span className="text-xs text-muted-foreground">{data.date}</span>
          </>
        )}
      </div>
      <div className="space-y-1">
        {payload.map((entry, index) => {
          const displayValue = typeof entry.value === 'number' 
            ? entry.dataKey === 'uptime' 
              ? `${entry.value.toFixed(1)}%`
              : entry.value.toString()
            : entry.value;
            
          return (
            <div key={`${entry.dataKey}-${index}`} className="flex items-center gap-2">
              <div 
                className="w-2 h-2 rounded-full flex-shrink-0" 
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-xs text-foreground truncate">
                {entry.name || entry.dataKey}: <span className="font-medium">{displayValue}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default function Home() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Dashboard", isCurrentPage: true },
  ];

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const [dashboardResponse, alertsResponse] = await Promise.all([
        fetch(`/api/dashboard?t=${Date.now()}`, { 
          signal: controller.signal,
          headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        }),
        fetch('/api/alerts/history', { 
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }
        })
      ]);

      clearTimeout(timeoutId);

      if (!dashboardResponse.ok) {
        throw new Error(`Dashboard API error: ${dashboardResponse.status} ${dashboardResponse.statusText}`);
      }

      const data = await dashboardResponse.json();
      const alertsData = alertsResponse.ok ? await alertsResponse.json() : [];
      
      // Validate and sanitize the API response
      const systemIssues: SystemHealth['issues'] = [];

      // Analyze system health with proper validation
      const monitorsDown = Number(data.monitors?.down) || 0;
      if (monitorsDown > 0) {
        systemIssues.push({
          type: 'monitor' as const,
          message: `${monitorsDown} monitor${monitorsDown === 1 ? '' : 's'} ${monitorsDown === 1 ? 'is' : 'are'} down`,
          severity: monitorsDown > 2 ? 'critical' as const : 'high' as const
        });
      }

      const failedJobs = Number(data.jobs?.failedRuns24h) || 0;
      if (failedJobs > 0) {
        systemIssues.push({
          type: 'job' as const,
          message: `${failedJobs} job${failedJobs === 1 ? '' : 's'} failed in the last 24 hours`,
          severity: failedJobs > 5 ? 'high' as const : 'medium' as const
        });
      }

      const queueRunning = Number(data.queue?.running) || 0;
      const queueCapacity = Number(data.queue?.runningCapacity) || 100;
      if (queueRunning >= queueCapacity * 0.9) {
        systemIssues.push({
          type: 'queue' as const,
          message: 'Queue capacity is running high',
          severity: 'medium' as const
        });
      }

      // Sanitize and validate all data
      const transformedData: DashboardData = {
        stats: {
          tests: Math.max(0, Number(data.tests?.total) || 0),
          jobs: Math.max(0, Number(data.jobs?.total) || 0),
          monitors: Math.max(0, Number(data.monitors?.total) || 0),
          runs: Math.max(0, Number(data.jobs?.recentRuns7d) || 0),
        },
        monitors: {
          total: Math.max(0, Number(data.monitors?.total) || 0),
          active: Math.max(0, Number(data.monitors?.active) || 0),
          up: Math.max(0, Number(data.monitors?.up) || 0),
          down: Math.max(0, Number(data.monitors?.down) || 0),
          uptime: Math.max(0, Math.min(100, Number(data.monitors?.uptime) || 0)),
          criticalAlerts: Array.isArray(data.monitors?.criticalAlerts) ? data.monitors.criticalAlerts.slice(0, 100) : [],
          byType: Array.isArray(data.monitors?.byType) ? data.monitors.byType.slice(0, 20) : [],
          responseTime: {
            avg: data.monitors?.responseTime?.avg !== null ? Number(data.monitors.responseTime.avg) || null : null,
            min: data.monitors?.responseTime?.min !== null ? Number(data.monitors.responseTime.min) || null : null,
            max: data.monitors?.responseTime?.max !== null ? Number(data.monitors.responseTime.max) || null : null,
          },
          availabilityTrend: Array.isArray(data.monitors?.availabilityTrend) ? data.monitors.availabilityTrend.slice(0, 30) : undefined,
        },
        jobs: {
          total: Math.max(0, Number(data.jobs?.total) || 0),
          successfulRuns24h: Math.max(0, Number(data.jobs?.successfulRuns24h) || 0),
          failedRuns24h: Math.max(0, Number(data.jobs?.failedRuns24h) || 0),
          recentRuns: Array.isArray(data.jobs?.recentRuns) ? data.jobs.recentRuns.slice(0, 1000) : [],
          executionTime: {
            totalMs: Math.max(0, Number(data.jobs?.executionTime?.totalMs) || 0),
            totalSeconds: Math.max(0, Number(data.jobs?.executionTime?.totalSeconds) || 0),
            totalMinutes: Math.max(0, Number(data.jobs?.executionTime?.totalMinutes) || 0),
            processedRuns: Math.max(0, Number(data.jobs?.executionTime?.processedRuns) || 0),
            skippedRuns: Math.max(0, Number(data.jobs?.executionTime?.skippedRuns) || 0),
            errors: Math.max(0, Number(data.jobs?.executionTime?.errors) || 0),
            period: data.jobs?.executionTime?.period || 'last 7 days'
          }
        },
        tests: {
          total: Math.max(0, Number(data.tests?.total) || 0),
          byType: Array.isArray(data.tests?.byType) ? data.tests.byType.slice(0, 20) : [],
          playgroundExecutions7d: Math.max(0, Number(data.tests?.playgroundExecutions7d) || 0),
          playgroundExecutionsTrend: Array.isArray(data.tests?.playgroundExecutionsTrend) ? data.tests.playgroundExecutionsTrend.slice(0, 30) : [],
        },
        alerts: Array.isArray(alertsData) ? alertsData.slice(0, 10) : [],
        system: {
          timestamp: typeof data.system?.timestamp === 'string' ? data.system.timestamp : new Date().toISOString(),
          healthy: Boolean(data.system?.healthy ?? systemIssues.length === 0),
          issues: systemIssues
        },
      };
      
      setDashboardData(transformedData);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          setError('Request timed out. Please try again.');
        } else {
          // Don't expose detailed error messages to users for security
          setError('Failed to load dashboard. Please try again.');
        }
      } else {
        setError('An unexpected error occurred while loading the dashboard.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Check for project switch success and refresh data
  useEffect(() => {
    const projectName = sessionStorage.getItem('projectSwitchSuccess');
    if (projectName) {
      sessionStorage.removeItem('projectSwitchSuccess');
      
      // Force refresh dashboard data when project is switched
      // Add a small delay to ensure session has propagated
      setTimeout(() => {
        fetchDashboardData();
      }, 100);
      
      setTimeout(() => {
        toast.success(`Switched to ${projectName}`);
      }, 500);
    }
  }, [fetchDashboardData]);

  // Memoized chart data to prevent unnecessary recalculations
  const chartData = useMemo(() => {
    if (!dashboardData) return null;

    // Chart data preparation - use 7 days data from recentRuns with robust validation
    const jobRuns7dData = dashboardData.jobs.recentRuns && Array.isArray(dashboardData.jobs.recentRuns) ? 
      dashboardData.jobs.recentRuns.filter(run => {
        if (!run?.startedAt || typeof run.startedAt !== 'string') return false;
        try {
          const runDate = new Date(run.startedAt);
          if (isNaN(runDate.getTime())) return false;
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          return runDate >= sevenDaysAgo;
        } catch {
          return false;
        }
      }).reduce((acc: {success: number, failed: number}, run) => {
        if (run?.status === 'passed') acc.success++;
        else if (run?.status === 'failed') acc.failed++;
        return acc;
      }, {success: 0, failed: 0}) : {success: 0, failed: 0};

    const jobRunsData = [
      { name: 'Success', count: jobRuns7dData.success, fill: '#22c55e' },
      { name: 'Failed', count: jobRuns7dData.failed, fill: '#ef4444' }
    ];

    const monitorStatusData = [
      { name: 'Up', count: dashboardData.monitors.up, fill: '#22c55e' },
      { name: 'Down', count: dashboardData.monitors.down, fill: '#ef4444' }
    ];

    // Test activity data - ensure full 7 days with robust validation
    const testActivityData = (() => {
      const today = new Date();
      const last7Days: ChartDataPoint[] = [];
      
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const fullDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        const dateStr = date.toISOString().split('T')[0];
        
        // Find matching trend data with validation
        const trendData = dashboardData.tests.playgroundExecutionsTrend?.find(
          (trend: { date: string; count: number }) => {
            return trend && typeof trend.date === 'string' && trend.date === dateStr;
          }
        );
        
        // Validate and ensure non-negative count
        const dayExecutions = trendData && typeof trendData.count === 'number' 
          ? Math.max(0, trendData.count) 
          : 0;
        
        last7Days.push({ 
          day: dayName, 
          executions: dayExecutions, 
          date: fullDate 
        });
      }
      return last7Days;
    })();

    // Job activity data - ensure full 7 days with proper typing and validation
    const jobActivityData = (() => {
      const today = new Date();
      const last7Days: Array<ChartDataPoint & { manual: number; scheduled: number; remote: number }> = [];
      
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const fullDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        // Robust filtering with proper validation
        const dayRuns = dashboardData.jobs.recentRuns?.filter(run => {
          if (!run?.startedAt || typeof run.startedAt !== 'string') return false;
          try {
            const runDate = new Date(run.startedAt);
            // Validate the date is not Invalid Date
            if (isNaN(runDate.getTime())) return false;
            return runDate.toDateString() === date.toDateString();
          } catch {
            return false;
          }
        }) || [];
        
        // Validate trigger values and count them
        const manual = dayRuns.filter(r => 
          !r.trigger || r.trigger === 'manual'
        ).length;
        const scheduled = dayRuns.filter(r => 
          r.trigger === 'schedule'
        ).length;
        const remote = dayRuns.filter(r => 
          r.trigger === 'remote'
        ).length;
        
        // Ensure non-negative values
        last7Days.push({ 
          day: dayName, 
          date: fullDate,
          manual: Math.max(0, manual),
          scheduled: Math.max(0, scheduled),
          remote: Math.max(0, remote)
        });
      }
      
      return last7Days;
    })();

    // Uptime trend data - always generate full 7 days
    const uptimeTrendData = (() => {
      const today = new Date();
      const trendData = [];
      
      // Generate data for the last 7 days (including today)
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const fullDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const dateStr = date.toISOString().split('T')[0];
        
        // Try to find real data first
        let uptime = 0;
        if (dashboardData.monitors.availabilityTrend && dashboardData.monitors.availabilityTrend.length > 0) {
          const realData = dashboardData.monitors.availabilityTrend.find(item => item.date === dateStr);
          if (realData) {
            uptime = Math.max(0, Math.min(100, realData.uptime));
          } else {
            // Use current overall uptime as fallback for missing days
            uptime = dashboardData.monitors.uptime || 0;
          }
        } else {
          // Use current overall uptime for all days when no trend data exists
          uptime = dashboardData.monitors.uptime || 0;
        }
        
        trendData.push({
          day: dayName,
          uptime: Math.round(uptime * 100) / 100, // Round to 2 decimal places
          date: fullDate
        });
      }
      
      return trendData;
    })();

    return {
      jobRunsData,
      monitorStatusData,
      testActivityData,
      jobActivityData,
      uptimeTrendData,
      jobRuns7dData
    };
  }, [dashboardData]);

  const chartConfig = {
    uptime: {
      label: "Uptime %",
      color: "hsl(var(--chart-1))",
    },
    success: {
      label: "Success",
      color: "hsl(var(--chart-2))",
    },
    failed: {
      label: "Failed",
      color: "hsl(var(--chart-3))",
    },
  };

  if (loading) {
    return (
      <div className="overflow-hidden">
        <PageBreadcrumbs items={breadcrumbs} />
        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
          <CardContent className="p-6 overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <div>
                <Skeleton className="h-7 w-56 mb-2" />
                <Skeleton className="h-4 w-96" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>

            {/* Key Metrics Grid - 5 cards per row */}
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 mb-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Card key={i}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-4" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-8 w-12 mb-1" />
                    <Skeleton className="h-3 w-24" />
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Top Row Charts - 3 charts per row */}
            <div className="grid gap-4 lg:grid-cols-3 mb-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="h-full p-4">
                  <CardHeader className="pb-1 px-3 pt-1">
                    <Skeleton className="h-4 w-20 mb-1" />
                    <Skeleton className="h-3 w-48" />
                  </CardHeader>
                  <CardContent className="p-2 pt-6">
                    <Skeleton className="h-40 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Bottom Row Charts - 3 charts per row */}
            <div className="grid gap-4 lg:grid-cols-3 mb-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="h-full p-4">
                  <CardHeader className="pb-1 px-3 pt-1">
                    {i === 0 ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <Skeleton className="h-4 w-24 mb-1" />
                          <Skeleton className="h-3 w-52" />
                        </div>
                      </div>
                    ) : i === 2 ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <Skeleton className="h-4 w-28 mb-1" />
                          <Skeleton className="h-3 w-56" />
                        </div>
                      </div>
                    ) : (
                      <>
                        <Skeleton className="h-4 w-24 mb-1" />
                        <Skeleton className="h-3 w-60" />
                      </>
                    )}
                  </CardHeader>
                  <CardContent className="p-2 pt-6">
                    <Skeleton className="h-40 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>

          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageBreadcrumbs items={breadcrumbs} />
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
          <div className="flex flex-col items-center text-center max-w-md space-y-6">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-foreground">Dashboard Error</h1>
              <p className="text-muted-foreground text-lg">
                {error}
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
              <Button onClick={() => window.location.reload()} className="flex-1 flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
              <Link href="/" className="flex-1">
                <Button variant="outline" className="w-full flex items-center gap-2">
                  <HomeIcon className="h-4 w-4" />
                  Go Home
                </Button>
              </Link>
            </div>
            
            <div className="text-xs text-muted-foreground bg-muted/30 px-3 py-2 rounded-md">
              If this problem persists, please contact support
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!dashboardData || !chartData) return null;

  return (
    <div className="overflow-hidden">
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent className="p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Project Dashboard</h1>
              <p className="text-muted-foreground text-sm">Overview of project&apos;s health, and performance.</p>
            </div>
            <div className="flex items-center gap-2">
              <div className={cn(
                "h-3 w-3 rounded-full",
                dashboardData.system.healthy ? "bg-green-500" : "bg-red-500"
              )} />
              <span className={cn(
                "text-sm font-medium",
                dashboardData.system.healthy ? "text-green-600" : "text-red-600"
              )}>
                {dashboardData.system.healthy ? "Operational" : "Issues Detected"}
              </span>
            </div>
          </div>

          {/* Key Metrics Grid - 5 cards per row */}
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 mb-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Tests</CardTitle>
                <Code className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {dashboardData.stats.tests > 0 ? (
                  <>
                    <div className="text-2xl font-bold">{dashboardData.stats.tests}</div>
                    <p className="text-sm text-muted-foreground">Available test cases</p>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-muted-foreground">No tests available</p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Jobs</CardTitle>
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {dashboardData.stats.jobs > 0 ? (
                  <>
                    <div className="text-2xl font-bold">{dashboardData.stats.jobs}</div>
                    <p className="text-sm text-muted-foreground">Scheduled jobs</p>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-muted-foreground">No jobs configured</p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Monitors</CardTitle>
                <Monitor className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {dashboardData.monitors.total > 0 ? (
                  <>
                    <div className="text-2xl font-bold">{dashboardData.monitors.active}</div>
                    <p className="text-sm text-muted-foreground">of {dashboardData.monitors.total} total</p>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-muted-foreground">No monitors setup</p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Runs</CardTitle>
                <NotepadText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {dashboardData.stats.runs > 0 ? (
                  <>
                    <div className="text-2xl font-bold">{dashboardData.stats.runs}</div>
                    <p className="text-sm text-muted-foreground">Last 7 days</p>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-muted-foreground">No runs available</p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Execution Time</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {dashboardData.jobs.executionTime.totalMinutes > 0 ? (
                  <>
                    <div className="text-2xl font-bold">
                      {dashboardData.jobs.executionTime.totalMinutes < 1 
                        ? `${dashboardData.jobs.executionTime.totalSeconds}s`
                        : `${dashboardData.jobs.executionTime.totalMinutes}m`
                      }
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {dashboardData.jobs.executionTime.processedRuns} runs • Last 7 days
                    </p>
                    {dashboardData.jobs.executionTime.errors > 0 && (
                      <p className="text-sm text-yellow-600">
                        {dashboardData.jobs.executionTime.errors} parsing errors
                      </p>
                    )}
                  </>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-muted-foreground">No execution time</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top Row Charts - 3 charts per row (formerly bottom row) */}
          <div className="grid gap-4 lg:grid-cols-3 mb-4">
            {/* Job Success Rate Chart */}
            <Card className="h-full p-4">
              <CardHeader className="pb-1 px-3 pt-1">
                <CardTitle className="flex items-center gap-1 text-sm">
                  <NotepadText className="h-4 w-4" />
                  Job Runs
                </CardTitle>
                <CardDescription className="text-sm">Job execution success vs failure last 7 days</CardDescription>
              </CardHeader>
              <CardContent className="p-2 pt-6">
                {(chartData.jobRuns7dData.success + chartData.jobRuns7dData.failed) > 0 ? (
                  <ChartContainer config={chartConfig} className="h-40 w-90">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData.jobRunsData}>
                        <XAxis dataKey="name" fontSize={11} />
                        <YAxis fontSize={11} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                          {chartData.jobRunsData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                ) : (
                  <div className="h-40 flex items-center justify-center">
                    <div className="text-center">
                      <NotepadText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No job runs</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Monitor Status Chart */}
          <Card className="h-full p-4">
              <CardHeader className="pb-1 px-3 pt-1">
                <CardTitle className="flex items-center gap-1 text-sm">
                  <Monitor className="h-4 w-4" />
                  Monitor Status
                </CardTitle>
                <CardDescription className="text-sm">Current monitor health distribution</CardDescription>
              </CardHeader>
               <CardContent className="p-2 pt-6">
                {dashboardData.monitors.total > 0 ? (
                  <ChartContainer config={chartConfig} className="h-40 w-90">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData.monitorStatusData}>
                        <XAxis dataKey="name" fontSize={11} />
                        <YAxis fontSize={11} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                          {chartData.monitorStatusData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                ) : (
                  <div className="h-40 flex items-center justify-center">
                    <div className="text-center">
                      <Monitor className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No monitors configured</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Test Types Distribution Chart */}
            <Card className="h-full p-4">
              <CardHeader className="pb-1 px-3 pt-1">
                <CardTitle className="flex items-center gap-1 text-sm">
                  <Code className="h-4 w-4" />
                  Test Types
                </CardTitle>
                <CardDescription className="text-sm">Distribution of test types</CardDescription>
              </CardHeader>
               <CardContent className="p-2 pt-6">
                {dashboardData.tests.byType && dashboardData.tests.byType.length > 0 ? (
                  <ChartContainer config={chartConfig} className="h-40 w-90">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={dashboardData.tests.byType.map((item) => {
                            const typeColorMap: Record<string, string> = {
                              'browser': '#0ea5e9',
                              'api': '#0d9488',
                              'database': '#0891b2',
                              'custom': '#2563eb',
                            };
                            return {
                              name: item.type,
                              value: item.count,
                              fill: typeColorMap[item.type.toLowerCase()] || '#6b7280'
                            };
                          })}
                          cx="50%"
                          cy="50%"
                          innerRadius={20}
                          outerRadius={60}
                          dataKey="value"
                          strokeWidth={0}
                        >
                        </Pie>
                        <ChartTooltip content={<ChartTooltipContent />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                ) : (
                  <div className="h-40 flex items-center justify-center">
                    <div className="text-center">
                      <Code className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No test types data</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Bottom Row Charts - 3 charts per row (formerly top row) */}
          <div className="grid gap-4 lg:grid-cols-3 mb-4">
            {/* Test Activity Trend Chart */}
            <Card className="h-full p-4">
              <CardHeader className="pb-1 px-3 pt-1">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-1 text-sm">
                      <Activity className="h-4 w-4" />
                      Test Activity
                    </CardTitle>
                    <CardDescription className="text-sm">Playground test executions last 7 days</CardDescription>
                  </div>
                </div>
              </CardHeader>
               <CardContent className="p-2 pt-6">
                {dashboardData.tests.playgroundExecutions7d > 0 ? (
                  <ChartContainer config={chartConfig} className="h-40 w-90">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData.testActivityData}>
                        <XAxis dataKey="day" fontSize={11} />
                        <YAxis fontSize={11} />
                        <ChartTooltip content={<CustomTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="executions"
                          stroke="#3b82f6"
                          fill="#3b82f6"
                          fillOpacity={0.2}
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                ) : (
                  <div className="h-40 flex items-center justify-center">
                    <div className="text-center">
                      <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No playground executions</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Job Activity Trend Chart */}
            <Card className="h-full p-4">
              <CardHeader className="pb-1 px-3 pt-1">
                <CardTitle className="flex items-center gap-1 text-sm">
                  <CalendarClock className="h-4 w-4" />
                  Job Activity
                </CardTitle>
                <CardDescription className="text-sm">Job execution by trigger types last 7 days</CardDescription>
              </CardHeader>
               <CardContent className="p-2 pt-6">
                {dashboardData.jobs.total > 0 ? (
                  <ChartContainer config={chartConfig} className="h-40 w-90">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData.jobActivityData}>
                        <XAxis dataKey="day" fontSize={11} />
                        <YAxis fontSize={11} />
                        <ChartTooltip content={<CustomTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="scheduled"
                          stackId="1"
                          stroke="#3b82f6"
                          fill="#3b82f6"
                          fillOpacity={0.6}
                          name="Scheduled"
                        />
                        <Area
                          type="monotone"
                          dataKey="manual"
                          stackId="1"
                          stroke="#10b981"
                          fill="#10b981"
                          fillOpacity={0.6}
                          name="Manual"
                        />
                        <Area
                          type="monotone"
                          dataKey="remote"
                          stackId="1"
                          stroke="#f59e0b"
                          fill="#f59e0b"
                          fillOpacity={0.6}
                          name="Remote"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                ) : (
                  <div className="h-40 flex items-center justify-center">
                    <div className="text-center">
                      <CalendarClock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No job activity</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Monitor Uptime Trend Chart */}
            <Card className="h-full p-4">
              <CardHeader className="pb-1 px-3 pt-1">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-1 text-sm">
                      <TrendingUp className="h-4 w-4" />
                      Uptime Trend
                    </CardTitle>
                    <CardDescription className="text-sm">Monitor uptime percentage last 7 days</CardDescription>
                  </div>
                </div>
              </CardHeader>
               <CardContent className="p-2 pt-6">
                {dashboardData.monitors.total > 0 ? (
                  <ChartContainer config={chartConfig} className="h-40 w-90">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData.uptimeTrendData}>
                        <XAxis dataKey="day" fontSize={11} />
                        <YAxis domain={[80, 100]} fontSize={10} />
                        <ChartTooltip content={<CustomTooltip />} />
                        <Line
                          type="monotone"
                          dataKey="uptime"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          dot={{ fill: "#3b82f6", strokeWidth: 0, r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                ) : (
                  <div className="h-40 flex items-center justify-center">
                    <div className="text-center">
                      <TrendingUp className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No uptime data</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}