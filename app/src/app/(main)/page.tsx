"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  CalendarClock,
  Activity,
  TrendingUp,
  Home as HomeIcon,
  Globe,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  Area,
  AreaChart,
} from "recharts";
import Link from "next/link";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { HealthInfo } from "@/components/dashboard/health-info";
import { MetricCard } from "@/components/dashboard/metric-card";
import { NeedsAttentionCard } from "@/components/dashboard/dashboard-panels";
import { SupercheckLogo } from "@/components/logo/supercheck-logo";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { formatTestTypeBreakdown } from "@/lib/dashboard/test-types";
import { useDashboard } from "@/hooks/use-dashboard";
import { useOpenIncidents } from "@/hooks/use-open-incidents";
import { useRequirementsStats } from "@/hooks/use-requirements-stats";
import {
  buildMonitorStatusBuckets,
  buildUptimeSeries,
  formatDayKey,
  lastDayKeys,
  uptimeAxis,
  utcDayKey,
} from "@/lib/dashboard/chart-data";
// Types are now exported from useDashboard hook
// Re-export for any components that still need them
export type { DashboardData } from "@/hooks/use-dashboard";

interface TooltipProps {
  active?: boolean;
  payload?: Array<{
    color: string;
    name: string;
    value: number | null;
    dataKey: string;
  }>;
  label?: string;
}

// Custom tooltip component with theme-aware styling
const CustomTooltip: React.FC<TooltipProps> = ({ active, payload, label }) => {
  const entries = (payload ?? []).filter(
    (entry) => typeof entry.value === "number"
  );
  if (!active || entries.length === 0) {
    return null;
  }

  return (
    <div className="min-w-0 rounded-md border border-border bg-background px-3 py-2 shadow-lg">
      <div className="mb-1 text-xs font-medium text-foreground">{label}</div>
      <div className="space-y-1">
        {entries.map((entry, index) => (
          <div key={`${entry.dataKey}-${index}`} className="flex items-center gap-2">
            <div
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="truncate text-xs text-foreground">
              {entry.name || entry.dataKey}:{" "}
              <span className="font-medium">
                {entry.dataKey === "uptime"
                  ? `${(entry.value as number).toFixed(2)}%`
                  : entry.value}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
const LOOKBACK_DAYS = 30;

/** Minutes with k/M notation for large values (number only; units are in the card title). */
const formatExecutionTime = (totalMinutes: number): string => {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return "0";
  if (totalMinutes < 1000) return Math.round(totalMinutes).toString();
  if (totalMinutes < 1000000) return `${(totalMinutes / 1000).toFixed(1)}k`;
  return `${(totalMinutes / 1000000).toFixed(1)}M`;
};

/** Compact number: "184", "1.2k", "1.5M". */
const formatCompactNumber = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) return "0";
  if (value < 1000) return Math.round(value).toString();
  if (value < 1000000) {
    const k = value / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }
  const m = value / 1000000;
  return m >= 100 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
};

const chartConfig = {
  uptime: { label: "Uptime %", color: "var(--success)" },
  executions: { label: "Executions", color: "var(--chart-1)" },
  scheduled: { label: "Scheduled", color: "var(--chart-1)" },
  manual: { label: "Manual", color: "var(--chart-2)" },
  remote: { label: "Remote", color: "var(--chart-3)" },
};

const DAY_AXIS = {
  interval: "preserveStartEnd" as const,
  minTickGap: 24,
  tickLine: false,
  fontSize: 11,
};

function ChartCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="space-y-1 px-4 pb-2 pt-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </CardTitle>
        <CardDescription className="line-clamp-1 text-xs" title={description}>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2 lg:min-h-0 lg:flex-1">{children}</CardContent>
    </Card>
  );
}

function ChartEmpty({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex h-44 flex-col items-center justify-center gap-2 text-muted-foreground lg:h-full">
      {icon}
      <p className="text-sm">{message}</p>
    </div>
  );
}

/** Chart rows share the remaining viewport height on desktop so the page never scrolls. */
const rowClass = "grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-3 lg:grid-rows-[minmax(0,1fr)]";

const mutedIcon = "h-4 w-4 text-muted-foreground";

export default function Home() {
  const isMounted = useSyncExternalStore(
    () => () => { },
    () => true,
    () => false
  );

  const { data: dashboardData, isLoading: queryLoading, isRestoring, error: queryError } = useDashboard();
  const { data: requirementsStats, isLoading: requirementsLoading } = useRequirementsStats();
  const { data: incidentsResult, isLoading: incidentsLoading } = useOpenIncidents();
  const hasData = dashboardData !== undefined && dashboardData !== null;
  const loading = !isMounted || isRestoring || (!hasData && queryLoading);
  const error = queryError?.message ?? null;

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Dashboard", isCurrentPage: true },
  ];

  const chartData = useMemo(() => {
    if (!dashboardData) return null;

    const now = new Date();
    const dayKeys = lastDayKeys(now, LOOKBACK_DAYS);
    const recentRuns = dashboardData.jobs.recentRuns ?? [];

    // Per-day trigger counts and overall success/failure in one pass (UTC days,
    // matching the SQL DATE() buckets used for the other daily series).
    const windowStart = dayKeys[0];
    const triggerByDay = new Map<string, { manual: number; scheduled: number; remote: number }>();
    // Totals come from the server (full 30 days); recentRuns is only used for per-day buckets.
    const success = dashboardData.jobs.passedRuns30d;
    const failed = dashboardData.jobs.failedRuns30d;
    for (const run of recentRuns) {
      const time = Date.parse(run?.startedAt ?? "");
      if (Number.isNaN(time)) continue;
      const key = utcDayKey(new Date(time));
      if (key < windowStart) continue;
      const bucket = triggerByDay.get(key) ?? { manual: 0, scheduled: 0, remote: 0 };
      if (run.trigger === "schedule") bucket.scheduled++;
      else if (run.trigger === "remote") bucket.remote++;
      else bucket.manual++;
      triggerByDay.set(key, bucket);
    }

    const playgroundByDay = new Map(
      (dashboardData.tests.playgroundExecutionsTrend ?? []).map((t) => [
        String(t.date).slice(0, 10),
        Math.max(0, Number(t.count) || 0),
      ])
    );

    const uptimeTrendData = buildUptimeSeries(
      dashboardData.monitors.availabilityTrend,
      LOOKBACK_DAYS,
      now
    );

    return {
      jobRunsData: [
        { name: "Success", count: success, fill: "var(--success)" },
        { name: "Failed", count: failed, fill: "var(--failure)" },
      ],
      jobRunsTotal: success + failed,
      monitorStatusData: buildMonitorStatusBuckets(dashboardData.monitors),
      testActivityData: dayKeys.map((key) => ({
        date: formatDayKey(key),
        executions: playgroundByDay.get(key) ?? 0,
      })),
      jobActivityData: dayKeys.map((key) => ({
        date: formatDayKey(key),
        ...(triggerByDay.get(key) ?? { manual: 0, scheduled: 0, remote: 0 }),
      })),
      uptimeTrendData,
      uptimeAxis: uptimeAxis(uptimeTrendData.map((p) => p.uptime)),
      hasUptimeData: uptimeTrendData.some((p) => p.uptime !== null),
    };
  }, [dashboardData]);

  if (loading) {
    return (
      <div className="overflow-hidden">
        <PageBreadcrumbs items={breadcrumbs} />
        <Card className="shadow-sm m-4">
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

            {/* Overview Content - matches main UI structure */}
            <div className="space-y-4 mt-4">
              {/* Key Metrics Grid - 6 cards per row */}
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 mb-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="relative overflow-hidden">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2 min-w-0 flex-1">
                          <Skeleton className="h-4 w-20" />
                          <Skeleton className="h-7 w-16" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Top Row Charts - 3 charts per row */}
              <div className="grid gap-4 lg:grid-cols-3 mb-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="h-full">
                    <CardHeader className="pb-2 px-4 pt-4">
                      <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                        <Skeleton className="h-4 w-20" />
                      </CardTitle>
                      <div className="text-xs text-muted-foreground/80">
                        <Skeleton className="h-3 w-48" />
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-4">
                      <Skeleton className="h-[202px] w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Bottom Row Charts - 3 charts per row */}
              <div className="grid gap-4 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="h-full">
                    <CardHeader className="pb-2 px-4 pt-4">
                      <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                        <Skeleton className="h-4 w-24" />
                      </CardTitle>
                      <div className="text-xs text-muted-foreground/80">
                        <Skeleton className="h-3 w-52" />
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-4">
                      <Skeleton className="h-[202px] w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Handle error state
  if (error) {
    return (
      <div>
        <PageBreadcrumbs items={breadcrumbs} />
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
          <div className="flex flex-col items-center text-center max-w-md space-y-6">
            <div className="relative flex h-16 w-16 items-center justify-center">
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
              <SupercheckLogo className="h-8 w-8 animate-pulse text-primary" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-foreground">
                Dashboard Error
              </h1>
              <p className="text-muted-foreground text-lg">{error}</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
              <Button
                onClick={() => window.location.reload()}
                className="flex-1 flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
              <Link href="/" className="flex-1">
                <Button
                  variant="outline"
                  className="w-full flex items-center gap-2"
                >
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

  // Handle missing data edge case
  // This is a safety net for rare cases where data is missing after loading completes.
  // Shows spinner instead of duplicate empty state (the real empty state is in the Overview tab).
  if (!dashboardData || !chartData || !dashboardData.system) {
    return (
      <div className="overflow-hidden">
        <PageBreadcrumbs items={breadcrumbs} />
        <div className="flex min-h-[60vh] items-center justify-center">
          <SupercheckLoading size="md" message="Loading dashboard..." />
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden lg:flex lg:h-[calc(100svh-var(--dashboard-chrome))] lg:min-h-[640px] lg:flex-col [--dashboard-chrome:4rem]">
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm m-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <CardContent className="p-6 overflow-hidden lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Project Dashboard
              </h1>
              <p className="text-muted-foreground text-sm">
                Overview of project&apos;s health, and key insights.
              </p>
            </div>
            <div className="flex items-center gap-1.5">
            <HealthInfo />
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="View system status details"
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors duration-200",
                    "cursor-pointer",
                    dashboardData.system.healthy
                      ? "bg-success/10 border-success/30 hover:bg-success/20 hover:border-success/50"
                      : "bg-failure/10 border-failure/30 hover:bg-failure/20 hover:border-failure/50"
                  )}
                >
                  <div
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      dashboardData.system.healthy
                        ? "bg-success"
                        : "bg-failure"
                    )}
                  />
                  <span
                    className={cn(
                      "text-sm font-medium",
                      dashboardData.system.healthy
                        ? "text-success"
                        : "text-failure"
                    )}
                  >
                    {dashboardData.system.healthy
                      ? "Operational"
                      : "Issues Detected"}
                  </span>
                  <ChevronDown className={cn(
                    "h-3.5 w-3.5 transition-colors",
                    dashboardData.system.healthy
                      ? "text-success"
                      : "text-failure"
                  )} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="end">
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "h-3 w-3 rounded-full",
                        dashboardData.system.healthy
                          ? "bg-success"
                          : "bg-failure"
                      )}
                    />
                    <h4 className="font-semibold leading-none">
                      {dashboardData.system.healthy
                        ? "System Status: Healthy"
                        : "System Issues Detected"}
                    </h4>
                  </div>
                  {dashboardData.system.healthy ? (
                    <p className="text-sm text-muted-foreground">
                      All systems are operational. No issues detected.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {(dashboardData.system.issues ?? []).map((issue, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-sm"
                        >
                          <div
                            className={cn(
                              "mt-1 h-2 w-2 rounded-full flex-shrink-0",
                              issue.severity === "critical" ||
                                issue.severity === "high"
                                ? "bg-failure"
                                : "bg-warning"
                            )}
                          />
                          <span className="text-muted-foreground">
                            {issue.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            </div>
          </div>

          <DashboardOverview
            dashboardData={dashboardData}
            chartData={chartData}
            requirementsStats={requirementsStats}
            requirementsLoading={requirementsLoading}
            incidentsResult={incidentsResult}
            incidentsLoading={incidentsLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}

interface DashboardOverviewProps {
  dashboardData: NonNullable<ReturnType<typeof useDashboard>["data"]>;
  chartData: ChartData;
  requirementsStats: ReturnType<typeof useRequirementsStats>["data"];
  requirementsLoading: boolean;
  incidentsResult: ReturnType<typeof useOpenIncidents>["data"];
  incidentsLoading: boolean;
}

type ChartData = {
  jobRunsData: Array<{ name: string; count: number; fill: string }>;
  jobRunsTotal: number;
  monitorStatusData: Array<{ name: string; count: number; fill: string }>;
  testActivityData: Array<{ date: string; executions: number }>;
  jobActivityData: Array<{ date: string; manual: number; scheduled: number; remote: number }>;
  uptimeTrendData: Array<{ date: string; uptime: number | null }>;
  uptimeAxis: { domain: [number, number]; ticks: number[] };
  hasUptimeData: boolean;
};

function DashboardOverview({
  dashboardData,
  chartData,
  requirementsStats,
  requirementsLoading,
  incidentsResult,
  incidentsLoading,
}: DashboardOverviewProps) {
  const { stats, monitors, jobs, tests, k6 } = dashboardData;

  if (stats.runs === 0 && stats.monitors === 0 && k6.totalRuns === 0) {
    return (
      <DashboardEmptyState
        title="No Project Activity"
        description="Your project dashboard is currently empty. Head over to the Quick Create section to set up your project resources."
        icon={<SupercheckLogo className="h-16 w-16" />}
        action={
          <Button asChild>
            <Link href="/create">Quick Create</Link>
          </Button>
        }
      />
    );
  }

  const hasRequirements = !!requirementsStats && requirementsStats.total > 0;
  const hasJobActivity = chartData.jobActivityData.some(
    (d) => d.manual + d.scheduled + d.remote > 0
  );

  return (
    <div className="mt-4 space-y-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          testId="metric-requirements"
          title="Requirements coverage"
          href="/requirements"
          value={hasRequirements ? `${requirementsStats.coveragePercent}%` : undefined}
          emptyMessage={requirementsLoading ? "Loading…" : "No requirements"}
          caption={
            hasRequirements && requirementsStats.atRiskCount > 0 ? (
              <span className="text-warning">{requirementsStats.atRiskCount} high priority at risk</span>
            ) : (
              "Covered by passing tests"
            )
          }
          info={{
            title: "How coverage is calculated",
            description: "Coverage is the share of requirements validated by passing tests.",
            bullets: [
              "Covered: all linked tests passed",
              "Failing: at least one linked test failed",
              "Missing: no tests linked, or none have run",
              "At risk: high priority requirements that are failing or missing",
              "Updates when jobs run, not playground tests",
            ],
            ariaLabel: "Learn how requirements coverage is calculated",
          }}
        />
        <MetricCard
          testId="metric-tests"
          title="Tests"
          href="/tests"
          value={stats.tests > 0 ? formatCompactNumber(stats.tests) : undefined}
          emptyMessage="No tests yet"
          caption={formatTestTypeBreakdown(tests.byType) || "Saved test cases"}
        />
        <MetricCard
          testId="metric-jobs"
          title="Jobs"
          href="/jobs"
          value={jobs.total > 0 ? formatCompactNumber(jobs.scheduled) : undefined}
          emptyMessage="No jobs configured"
          caption={`scheduled of ${formatCompactNumber(jobs.total)} total`}
        />
        <MetricCard
          testId="metric-monitors"
          title="Monitors"
          href="/monitors"
          value={
            monitors.total > 0
              ? `${formatCompactNumber(monitors.up)}/${formatCompactNumber(monitors.total)}`
              : undefined
          }
          emptyMessage="No monitors set up"
          caption={monitors.down > 0 ? `${monitors.down} down` : "up now"}
        />
        <MetricCard
          testId="metric-browser-minutes"
          title="Browser minutes"
          href="/runs?view=playwright"
          value={jobs.executionTime.totalMinutes > 0 ? formatExecutionTime(jobs.executionTime.totalMinutes) : undefined}
          emptyMessage="No browser minutes used"
          caption={`${formatCompactNumber(jobs.executionTime.processedRuns)} executions · Last 30 days`}
          info={{
            title: "Browser minutes used",
            description: "Playwright execution time in this project over the last 30 days.",
            bullets: [
              "Includes job runs, synthetic monitor checks (each location counted separately) and playground tests",
              "Estimated from recorded run durations for this project",
              "Billed usage is metered per organization and billing period, so it can differ",
              "Running executions are added once they finish",
            ],
            ariaLabel: "Learn what browser minutes includes",
          }}
        />
        <MetricCard
          testId="metric-k6-vu-minutes"
          title="k6 VU-minutes"
          href="/runs?view=k6"
          value={k6.totalRuns > 0 ? formatExecutionTime(k6.totalVuMinutes) : undefined}
          emptyMessage="No k6 runs"
          caption={`${formatCompactNumber(k6.totalRuns)} runs · Last 30 days`}
          info={{
            title: "k6 VU-minutes used",
            description: "Peak virtual users multiplied by run duration in minutes, over the last 30 days.",
            bullets: [
              "Includes k6 job runs and playground k6 runs in this project",
              "Completed runs only; running executions are added once they finish",
              "Billed usage is metered per organization and billing period, so it can differ",
            ],
            ariaLabel: "Learn what k6 VU-minutes includes",
          }}
        />
      </div>

      {/* Row 2: attention + status charts */}
      <div className={rowClass}>
        <NeedsAttentionCard
          runs={jobs.recentRuns}
          alerts={dashboardData.alerts}
          incidentsResult={incidentsResult}
          incidentsLoading={incidentsLoading}
        />
        <ChartCard
          title="Job Status"
          description="Successful vs failed (including errors) job runs, last 30 days"
          icon={<CalendarClock className={mutedIcon} />}
        >
          {chartData.jobRunsTotal > 0 ? (
            <ChartContainer config={chartConfig} className="h-44 w-full lg:h-full lg:min-h-24">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData.jobRunsData}>
                  <XAxis dataKey="name" fontSize={11} tickLine={false} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {chartData.jobRunsData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <ChartEmpty icon={<CalendarClock className="h-6 w-6" />} message="No job runs in the last 30 days" />
          )}
        </ChartCard>

        <ChartCard
          title="Monitor Status"
          description="Current monitors by status"
          icon={<Globe className={mutedIcon} />}
        >
          {monitors.total > 0 && chartData.monitorStatusData.length > 0 ? (
            <ChartContainer config={chartConfig} className="h-44 w-full lg:h-full lg:min-h-24">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData.monitorStatusData}>
                  <XAxis dataKey="name" fontSize={11} tickLine={false} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {chartData.monitorStatusData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <ChartEmpty icon={<Globe className="h-6 w-6" />} message="No monitors configured" />
          )}
        </ChartCard>
      </div>

      {/* Row 3: activity charts */}
      <div className={rowClass}>
        <ChartCard
          title="Test Activity"
          description="Playground test executions, last 30 days"
          icon={<Activity className={mutedIcon} />}
        >
          {tests.playgroundExecutions30d > 0 ? (
            <ChartContainer config={chartConfig} className="h-44 w-full lg:h-full lg:min-h-24">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData.testActivityData}>
                  <XAxis dataKey="date" {...DAY_AXIS} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <ChartTooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="executions"
                    name="Executions"
                    stroke="var(--chart-1)"
                    fill="var(--chart-1)"
                    fillOpacity={0.2}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <ChartEmpty icon={<Activity className="h-6 w-6" />} message="No playground executions" />
          )}
        </ChartCard>

        <ChartCard
          title="Job Activity"
          description="Job runs by trigger, last 30 days"
          icon={<Activity className={mutedIcon} />}
        >
          {hasJobActivity ? (
            <ChartContainer config={chartConfig} className="h-44 w-full lg:h-full lg:min-h-24">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData.jobActivityData}>
                  <XAxis dataKey="date" {...DAY_AXIS} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <ChartTooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="scheduled" name="Scheduled" stackId="1" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.5} />
                  <Area type="monotone" dataKey="manual" name="Manual" stackId="1" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.5} />
                  <Area type="monotone" dataKey="remote" name="Remote" stackId="1" stroke="var(--chart-3)" fill="var(--chart-3)" fillOpacity={0.5} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <ChartEmpty icon={<CalendarClock className="h-6 w-6" />} message="No job activity" />
          )}
        </ChartCard>

        <ChartCard
          title="Uptime Trend"
          description="Daily monitor uptime, last 30 days (days without checks are left blank)"
          icon={<TrendingUp className={mutedIcon} />}
        >
          {monitors.total > 0 && chartData.hasUptimeData ? (
            <ChartContainer config={chartConfig} className="h-44 w-full lg:h-full lg:min-h-24">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData.uptimeTrendData}>
                  <XAxis dataKey="date" {...DAY_AXIS} />
                  <YAxis
                    domain={chartData.uptimeAxis.domain}
                    ticks={chartData.uptimeAxis.ticks}
                    tickFormatter={(v) => `${v}%`}
                    fontSize={11}
                    width={40}
                  />
                  <ChartTooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="uptime"
                    name="Uptime"
                    stroke="var(--success)"
                    strokeWidth={2}
                    connectNulls={false}
                    dot={{ fill: "var(--success)", strokeWidth: 0, r: 2.5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <ChartEmpty icon={<TrendingUp className="h-6 w-6" />} message="No uptime data in the last 30 days" />
          )}
        </ChartCard>
      </div>
    </div>
  );
}
