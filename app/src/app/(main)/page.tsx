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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Code,
  CalendarClock,
  Activity,
  TrendingUp,
  Home as HomeIcon,
  Info,
  Globe,
  RefreshCw,
  LayoutDashboard,
  Zap,
  TestTube,
  ArrowRightLeft,
  ChevronDown,
  FileText,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  BarChart,
  Bar,
  PieChart,
  Pie,
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
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { K6Logo } from "@/components/logo/k6-logo";
import { K6AnalyticsTab } from "@/components/dashboard/k6-analytics-tab";
import { PlaywrightAnalyticsTab } from "@/components/dashboard/playwright-analytics-tab";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { CheckIcon } from "@/components/logo/supercheck-logo";
import { useDashboard, type DashboardData } from "@/hooks/use-dashboard";
import { useRequirementsStats } from "@/hooks/use-requirements-stats";
// Types are now exported from useDashboard hook
// Re-export for any components that still need them
export type { DashboardData } from "@/hooks/use-dashboard";

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

interface MetricInfoButtonProps {
  title: string;
  description: string;
  bullets: string[];
  ariaLabel: string;
  align?: "start" | "center" | "end";
}

const MetricInfoButton: React.FC<MetricInfoButtonProps> = ({
  title,
  description,
  bullets,
  ariaLabel,
  align = "start",
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 p-0 text-muted-foreground"
        aria-label={ariaLabel}
      >
        <Info className="h-4 w-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      className="w-72 p-4 space-y-2"
      side="bottom"
      align={align}
      sideOffset={12}
    >
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {description}
        </p>
        <ul className="list-disc pl-4 space-y-1 text-xs text-muted-foreground">
          {bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </PopoverContent>
  </Popover>
);

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
          const displayValue =
            typeof entry.value === "number"
              ? entry.dataKey === "uptime"
                ? `${entry.value.toFixed(1)}%`
                : entry.value.toString()
              : entry.value;

          return (
            <div
              key={`${entry.dataKey}-${index}`}
              className="flex items-center gap-2"
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-xs text-foreground truncate">
                {entry.name || entry.dataKey}:{" "}
                <span className="font-medium">{displayValue}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
const LOOKBACK_DAYS = 30;

/**
 * Formats execution time for display in dashboard metric cards.
 * Shows just the number without unit suffix since units are displayed in card titles.
 * Handles edge cases and provides compact notation for large values.
 *
 * @param totalMinutes - Total execution time in minutes
 * @param totalSeconds - Total execution time in seconds (fallback for <1 minute)
 * @returns Formatted time string (number only, no unit suffix)
 */
const formatExecutionTime = (
  totalMinutes: number,
  totalSeconds: number
): string => {
  // Validate inputs
  if (!Number.isFinite(totalMinutes) || !Number.isFinite(totalSeconds)) {
    return "0";
  }

  // Handle negative values
  if (totalMinutes < 0 || totalSeconds < 0) {
    return "0";
  }

  // Less than 1 minute: round to nearest minute (shows as 0 or 1)
  if (totalMinutes < 1) {
    return Math.round(totalMinutes).toString();
  }

  // 1 to 999 minutes: show rounded minutes
  if (totalMinutes < 1000) {
    return Math.round(totalMinutes).toString();
  }

  // 1,000 to 999,999 minutes: show in k notation with 1 decimal place
  if (totalMinutes < 1000000) {
    const kMinutes = totalMinutes / 1000;
    return `${kMinutes.toFixed(1)}k`;
  }

  // 1,000,000+ minutes: show in M notation with 1 decimal place
  const mMinutes = totalMinutes / 1000000;
  return `${mMinutes.toFixed(1)}M`;
};

/**
 * Formats a number with compact notation for better readability
 * - Shows as-is if less than 1000 (e.g., "184")
 * - Shows 'k' notation for 1,000-999,999 (e.g., "1.2k")
 * - Shows 'M' notation for 1,000,000+ (e.g., "1.5M")
 *
 * @param value - Number to format
 * @returns Formatted string with appropriate unit
 */
const formatCompactNumber = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) {
    return "0";
  }

  if (value < 1000) {
    return Math.round(value).toString();
  }

  if (value < 1000000) {
    const k = value / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }

  const m = value / 1000000;
  return m >= 100 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
};

export default function Home() {
  // Use React Query hook for dashboard data (cached, auto-refreshes)
  const { data: dashboardData, isLoading: loading, error: queryError, refetch } = useDashboard();
  const error = queryError?.message ?? null;

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Dashboard", isCurrentPage: true },
  ];

  // Check for project switch success and refresh data
  useEffect(() => {
    const projectName = sessionStorage.getItem("projectSwitchSuccess");
    if (projectName) {
      sessionStorage.removeItem("projectSwitchSuccess");

      // Force refresh dashboard data when project is switched
      // Add a small delay to ensure session has propagated
      setTimeout(() => {
        refetch();
      }, 100);

      setTimeout(() => {
        toast.success(`Switched to ${projectName}`);
      }, 500);
    }
  }, [refetch]);

  // Memoized chart data to prevent unnecessary recalculations
  const chartData = useMemo(() => {
    if (!dashboardData) return null;

    // Chart data preparation - use LOOKBACK_DAYS data from recentRuns with robust validation
    const lookbackThreshold = (() => {
      const threshold = new Date();
      threshold.setHours(0, 0, 0, 0);
      threshold.setDate(threshold.getDate() - (LOOKBACK_DAYS - 1));
      return threshold;
    })();

    const jobRunsWindowData =
      dashboardData.jobs.recentRuns &&
        Array.isArray(dashboardData.jobs.recentRuns)
        ? dashboardData.jobs.recentRuns
          .filter((run) => {
            if (!run?.startedAt || typeof run.startedAt !== "string")
              return false;
            try {
              const runDate = new Date(run.startedAt);
              if (isNaN(runDate.getTime())) return false;
              return runDate >= lookbackThreshold;
            } catch {
              return false;
            }
          })
          .reduce(
            (acc: { success: number; failed: number }, run) => {
              if (run?.status === "passed") acc.success++;
              else if (run?.status === "failed") acc.failed++;
              return acc;
            },
            { success: 0, failed: 0 }
          )
        : { success: 0, failed: 0 };

    const jobRunsData = [
      { name: "Success", count: jobRunsWindowData.success, fill: "#22c55e" },
      { name: "Failed", count: jobRunsWindowData.failed, fill: "#ef4444" },
    ];

    const monitorStatusData = [
      { name: "Up", count: dashboardData.monitors.up, fill: "#22c55e" },
      { name: "Down", count: dashboardData.monitors.down, fill: "#ef4444" },
    ];

    // Test activity data - ensure full LOOKBACK_DAYS with robust validation
    const testActivityData = (() => {
      const today = new Date();
      const windowDays: ChartDataPoint[] = [];

      for (let i = LOOKBACK_DAYS - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
        const fullDate = date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });

        const dateStr = date.toISOString().split("T")[0];

        // Find matching trend data with validation
        const trendData = dashboardData.tests.playgroundExecutionsTrend?.find(
          (trend: { date: string; count: number }) => {
            return (
              trend && typeof trend.date === "string" && trend.date === dateStr
            );
          }
        );

        // Validate and ensure non-negative count
        const dayExecutions =
          trendData && typeof trendData.count === "number"
            ? Math.max(0, trendData.count)
            : 0;

        windowDays.push({
          day: dayName,
          executions: dayExecutions,
          date: fullDate,
        });
      }
      return windowDays;
    })();

    // Job activity data - ensure full LOOKBACK_DAYS with proper typing and validation
    const jobActivityData = (() => {
      const today = new Date();
      const windowDays: Array<
        ChartDataPoint & { manual: number; scheduled: number; remote: number }
      > = [];

      for (let i = LOOKBACK_DAYS - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
        const fullDate = date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });

        // Robust filtering with proper validation
        const dayRuns =
          dashboardData.jobs.recentRuns?.filter((run) => {
            if (!run?.startedAt || typeof run.startedAt !== "string")
              return false;
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
        const manual = dayRuns.filter(
          (r) => !r.trigger || r.trigger === "manual"
        ).length;
        const scheduled = dayRuns.filter(
          (r) => r.trigger === "schedule"
        ).length;
        const remote = dayRuns.filter((r) => r.trigger === "remote").length;

        // Ensure non-negative values
        windowDays.push({
          day: dayName,
          date: fullDate,
          manual: Math.max(0, manual),
          scheduled: Math.max(0, scheduled),
          remote: Math.max(0, remote),
        });
      }

      return windowDays;
    })();

    // Uptime trend data - always generate full LOOKBACK_DAYS
    const uptimeTrendData = (() => {
      const today = new Date();
      const trendData = [];

      // Generate data for the last LOOKBACK_DAYS (including today)
      for (let i = LOOKBACK_DAYS - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);

        const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
        const fullDate = date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        const dateStr = date.toISOString().split("T")[0];

        // Try to find real data first
        let uptime = 0;
        if (
          dashboardData.monitors.availabilityTrend &&
          dashboardData.monitors.availabilityTrend.length > 0
        ) {
          const realData = dashboardData.monitors.availabilityTrend.find(
            (item) => item.date === dateStr
          );
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
          date: fullDate,
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
      jobRunsWindowData,
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
                        <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Top Row Charts - 3 charts per row */}
              <div className="grid gap-4 lg:grid-cols-3 mb-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="h-full border-border/50 hover:shadow-md transition-shadow duration-200">
                    <CardHeader className="pb-2 px-4 pt-4">
                      <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                        <Skeleton className="h-7 w-7 rounded-md" />
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
                  <Card key={i} className="h-full border-border/50 hover:shadow-md transition-shadow duration-200">
                    <CardHeader className="pb-2 px-4 pt-4">
                      <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                        <Skeleton className="h-7 w-7 rounded-md" />
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

  if (error) {
    return (
      <div>
        <PageBreadcrumbs items={breadcrumbs} />
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
          <div className="flex flex-col items-center text-center max-w-md space-y-6">
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

  if (!dashboardData || !chartData) return null;

  return (
    <div className="overflow-hidden">
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent className="p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Project Dashboard
              </h1>
              <p className="text-muted-foreground text-sm">
                Overview of project&apos;s health, and key insights.
              </p>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="View system status details"
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors duration-200",
                    "cursor-pointer",
                    dashboardData.system.healthy
                      ? "bg-green-500/10 border-green-500/30 hover:bg-green-500/20 hover:border-green-500/50"
                      : "bg-red-500/10 border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50"
                  )}
                >
                  <div
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      dashboardData.system.healthy
                        ? "bg-green-500"
                        : "bg-red-500"
                    )}
                  />
                  <span
                    className={cn(
                      "text-sm font-medium",
                      dashboardData.system.healthy
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    )}
                  >
                    {dashboardData.system.healthy
                      ? "Operational"
                      : "Issues Detected"}
                  </span>
                  <ChevronDown className={cn(
                    "h-3.5 w-3.5 transition-colors",
                    dashboardData.system.healthy
                      ? "text-green-500"
                      : "text-red-500"
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
                          ? "bg-green-500"
                          : "bg-red-500"
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
                      {dashboardData.system.issues.map((issue, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-sm"
                        >
                          <div
                            className={cn(
                              "mt-1 h-2 w-2 rounded-full flex-shrink-0",
                              issue.severity === "critical" ||
                                issue.severity === "high"
                                ? "bg-red-500"
                                : "bg-yellow-500"
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

          {/* Dashboard Tabs */}
          <DashboardTabs dashboardData={dashboardData} chartData={chartData} chartConfig={chartConfig} />
        </CardContent>
      </Card>
    </div>
  );
}

// Separate component for dashboard tabs to manage filter state
interface DashboardTabsProps {
  dashboardData: DashboardData;
  chartData: any;
  chartConfig: Record<string, { label: string; color?: string }>;
}

function DashboardTabs({ dashboardData, chartData, chartConfig }: DashboardTabsProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [k6SelectedJob, setK6SelectedJob] = useState<string | null>(null);
  const [k6Period, setK6Period] = useState(30);
  const [k6CompareOpen, setK6CompareOpen] = useState(false);
  const [pwSelectedJob, setPwSelectedJob] = useState<string | null>(null);
  const [pwPeriod, setPwPeriod] = useState(30);
  const [k6Jobs, setK6Jobs] = useState<Array<{ id: string; name: string }>>([]);
  const [pwJobs, setPwJobs] = useState<Array<{ id: string; name: string }>>([]);

  // Fetch requirements stats for dashboard card
  const { data: requirementsStats } = useRequirementsStats();

  // Fetch K6 jobs for filter dropdown
  useEffect(() => {
    if (activeTab === "k6") {
      fetch("/api/analytics/k6?period=30")
        .then(res => res.json())
        .then(data => {
          const jobs = data.jobs || [];
          setK6Jobs(jobs);
          // Auto-select first job if not already selected
          if (!k6SelectedJob && jobs.length > 0) {
            setK6SelectedJob(jobs[0].id);
          }
        })
        .catch(() => { });
    }
  }, [activeTab, k6SelectedJob]);

  // Fetch Playwright jobs for filter dropdown
  useEffect(() => {
    if (activeTab === "playwright") {
      fetch("/api/analytics/playwright?period=30")
        .then(res => res.json())
        .then(data => {
          const jobs = data.jobs || [];
          setPwJobs(jobs);
          // Auto-select first job if not already selected
          if (!pwSelectedJob && jobs.length > 0) {
            setPwSelectedJob(jobs[0].id);
          }
        })
        .catch(() => { });
    }
  }, [activeTab, pwSelectedJob]);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <LayoutDashboard className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="k6" className="gap-2">
            <K6Logo className="h-4 w-4" />
            K6 Job Analytics
          </TabsTrigger>
          <TabsTrigger value="playwright" className="gap-2">
            <PlaywrightLogo className="h-4 w-4" />
            Playwright Job Analytics
          </TabsTrigger>
        </TabsList>

        {/* Inline Filters - only show for K6/Playwright tabs */}
        {activeTab === "k6" && k6Jobs.length > 0 && (
          <div className="flex items-center gap-3">
            {k6SelectedJob && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2"
                onClick={() => setK6CompareOpen(true)}
              >
                <ArrowRightLeft className="h-4 w-4 text-blue-500" />
                Compare Runs
              </Button>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-muted-foreground">Job:</span>
              <Select value={k6SelectedJob ?? ""} onValueChange={setK6SelectedJob}>
                <SelectTrigger className="w-56 h-9">
                  <SelectValue placeholder="Select a job" />
                </SelectTrigger>
                <SelectContent>
                  {k6Jobs.map((job) => (
                    <SelectItem key={job.id} value={job.id}>{job.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-muted-foreground">Period:</span>
              <Select value={k6Period.toString()} onValueChange={(v) => setK6Period(parseInt(v))}>
                <SelectTrigger className="w-28 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="60">60 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {activeTab === "playwright" && pwJobs.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-muted-foreground">Job:</span>
              <Select value={pwSelectedJob ?? ""} onValueChange={setPwSelectedJob}>
                <SelectTrigger className="w-56 h-9">
                  <SelectValue placeholder="Select a job" />
                </SelectTrigger>
                <SelectContent>
                  {pwJobs.map((job) => (
                    <SelectItem key={job.id} value={job.id}>{job.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-muted-foreground">Period:</span>
              <Select value={pwPeriod.toString()} onValueChange={(v) => setPwPeriod(parseInt(v))}>
                <SelectTrigger className="w-28 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="60">60 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      <TabsContent value="overview">
        {dashboardData.stats.runs === 0 && dashboardData.stats.monitors === 0 ? (
          <DashboardEmptyState
            title="No Project Activity"
            description="Your project dashboard is currently empty. Head over to the Quick Create section to set up your project resources."
            icon={<CheckIcon className="h-16 w-16" />}
            action={
              <Button asChild>
                <Link href="/create">Quick Create</Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            {/* Key Metrics Grid - 6 cards per row */}
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 mb-4">
              {/* Requirements Card - First position per spec */}
              <Card className="relative overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 min-w-0 flex-1">
                      <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                        Requirements
                        <MetricInfoButton
                          title="How Coverage is Calculated"
                          description="Coverage shows the percentage of requirements validated by passing tests."
                          bullets={[
                            "Covered: All linked tests passed",
                            "Failing: At least one linked test failed",
                            "Missing: No tests linked or none have run",
                            "Coverage updates when jobs run, not playground tests",
                          ]}
                          ariaLabel="Learn how requirements coverage is calculated"
                        />
                      </p>
                      {requirementsStats?.total && requirementsStats.total > 0 ? (
                        <>
                          <div className="text-2xl font-bold tracking-tight truncate">
                            {requirementsStats.coveragePercent}%
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {requirementsStats.atRiskCount > 0 ? (
                              <span className="text-orange-500">{requirementsStats.atRiskCount} at-risk</span>
                            ) : (
                              "Coverage"
                            )}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground py-2">
                          No requirements
                        </p>
                      )}
                    </div>
                    <div className="rounded-lg bg-purple-500/10 p-2 shrink-0">
                      <FileText className="h-4 w-4 text-purple-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="relative overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 min-w-0 flex-1">
                      <p className="text-sm font-medium text-muted-foreground">
                        Total Tests
                      </p>
                      {dashboardData.stats.tests > 0 ? (
                        <>
                          <div className="text-2xl font-bold tracking-tight truncate">
                            {formatCompactNumber(dashboardData.stats.tests)}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Available test cases
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground py-2">
                          No tests available
                        </p>
                      )}
                    </div>
                    <div className="rounded-lg bg-blue-500/10 p-2 shrink-0">
                      <Code className="h-4 w-4 text-blue-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="relative overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 min-w-0 flex-1">
                      <p className="text-sm font-medium text-muted-foreground">
                        Active Jobs
                      </p>
                      {dashboardData.stats.jobs > 0 ? (
                        <>
                          <div className="text-2xl font-bold tracking-tight truncate">
                            {formatCompactNumber(dashboardData.stats.jobs)}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Scheduled jobs
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground py-2">
                          No jobs configured
                        </p>
                      )}
                    </div>
                    <div className="rounded-lg bg-amber-500/10 p-2 shrink-0">
                      <CalendarClock className="h-4 w-4 text-amber-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="relative overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 min-w-0 flex-1">
                      <p className="text-sm font-medium text-muted-foreground">
                        Active Monitors
                      </p>
                      {dashboardData.monitors.total > 0 ? (
                        <>
                          <div className="text-2xl font-bold tracking-tight truncate">
                            {formatCompactNumber(dashboardData.monitors.active)}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            of {formatCompactNumber(dashboardData.monitors.total)} total
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground py-2">
                          No monitors setup
                        </p>
                      )}
                    </div>
                    <div className="rounded-lg bg-green-500/10 p-2 shrink-0">
                      <Globe className="h-4 w-4 text-green-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="relative overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 min-w-0 flex-1">
                      <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                        Playwright Mins
                        <MetricInfoButton
                          title="How we calculate Playwright Mins"
                          description="Aggregates execution time from all Playwright test runs in the past 30 days."
                          bullets={[
                            "Covers the last 30 days of execution",
                            "Includes job runs, synthetic monitor checks, and playground tests",
                            "Each monitor location is counted separately",
                            "Running executions are added once they finish",
                          ]}
                          ariaLabel="Learn what Playwright Mins includes"
                          align="end"
                        />
                      </p>
                      {dashboardData.jobs.executionTime.totalMinutes > 0 ? (
                        <>
                          <div className="text-2xl font-bold tracking-tight truncate">
                            {formatExecutionTime(
                              dashboardData.jobs.executionTime.totalMinutes,
                              dashboardData.jobs.executionTime.totalSeconds
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {formatCompactNumber(dashboardData.jobs.executionTime.processedRuns)}{" "}
                            runs • Last 30 days
                          </p>
                          {dashboardData.jobs.executionTime.errors > 0 && (
                            <p className="text-xs text-yellow-600">
                              {dashboardData.jobs.executionTime.errors} parsing
                              errors
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground py-2">
                          No execution time
                        </p>
                      )}
                    </div>
                    <div className="rounded-lg bg-cyan-500/10 p-2 shrink-0">
                      <PlaywrightLogo width={16} height={16} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="relative overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 min-w-0 flex-1">
                      <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                        k6 VU x Mins
                        <MetricInfoButton
                          title="How we calculate k6 VU Mins"
                          description="Execution time aggregates every k6-powered run in the past 30 days."
                          bullets={[
                            "Covers the last 30 days of execution",
                            "Includes k6 job runs and playground tests",
                            "Calculated from completed k6 test runs only",
                            "Running executions are added once they finish",
                          ]}
                          ariaLabel="Learn what k6 VU Minutes includes"
                          align="end"
                        />
                      </p>
                      {dashboardData.k6.totalRuns > 0 ? (
                        <>
                          <div className="text-2xl font-bold tracking-tight truncate">
                            {formatExecutionTime(
                              dashboardData.k6.totalVuMinutes,
                              Math.floor(dashboardData.k6.totalDurationMs / 1000)
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {formatCompactNumber(dashboardData.k6.totalRuns)} runs • Last 30 days
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground py-2">
                          No k6 tests run
                        </p>
                      )}
                    </div>
                    <div className="rounded-lg bg-violet-500/10 p-2 shrink-0">
                      <K6Logo width={16} height={16} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Top Row Charts - 3 charts per row */}
            <div className="grid gap-4 lg:grid-cols-3 mb-4">
              {/* Job Success Rate Chart */}
              <Card className="h-full border-border/50 hover:shadow-md transition-shadow duration-200">
                <CardHeader className="pb-2 px-4 pt-4">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <div className="rounded-md bg-amber-500/10 p-1.5">
                      <CalendarClock className="h-4 w-4 text-amber-500" />
                    </div>
                    Job Status
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground/80">
                    Job execution success vs failure last 30 days
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-4">
                  {chartData.jobRunsWindowData.success +
                    chartData.jobRunsWindowData.failed >
                    0 ? (
                    <ChartContainer config={chartConfig} className="h-43 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData.jobRunsData}>
                          <XAxis dataKey="name" fontSize={11} />
                          <YAxis fontSize={11} />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                            {chartData.jobRunsData.map((entry: { name: string; count: number; fill: string }, index: number) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  ) : (
                    <div className="h-43 flex items-center justify-center">
                      <div className="text-center">
                        <CalendarClock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          No job runs
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Monitor Status Chart */}
              <Card className="h-full border-border/50 hover:shadow-md transition-shadow duration-200">
                <CardHeader className="pb-2 px-4 pt-4">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <div className="rounded-md bg-green-500/10 p-1.5">
                      <Globe className="h-4 w-4 text-green-500" />
                    </div>
                    Monitor Status
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground/80">
                    Current monitor health distribution
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-4">
                  {dashboardData.monitors.total > 0 ? (
                    <ChartContainer config={chartConfig} className="h-40 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData.monitorStatusData}>
                          <XAxis dataKey="name" fontSize={11} />
                          <YAxis fontSize={11} />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                            {chartData.monitorStatusData.map((entry: { name: string; count: number; fill: string }, index: number) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  ) : (
                    <div className="h-43 flex items-center justify-center">
                      <div className="text-center">
                        <Globe className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          No monitors configured
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Test Types Distribution Chart */}
              <Card className="h-full border-border/50 hover:shadow-md transition-shadow duration-200">
                <CardHeader className="pb-2 px-4 pt-4">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <div className="rounded-md bg-blue-500/10 p-1.5">
                      <Code className="h-4 w-4 text-blue-500" />
                    </div>
                    Test Types
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground/80">
                    Distribution of test types
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {dashboardData.tests.byType &&
                    dashboardData.tests.byType.length > 0 ? (
                    <div className="flex flex-col items-center">
                      {/* Centered Chart */}
                      <ChartContainer config={chartConfig} className="h-28 w-28">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={dashboardData.tests.byType.map((item) => {
                                const typeColorMap: Record<string, string> = {
                                  browser: "#0ea5e9",
                                  api: "#0d9488",
                                  database: "#0891b2",
                                  custom: "#2563eb",
                                };
                                return {
                                  name: item.type,
                                  value: item.count,
                                  fill:
                                    typeColorMap[item.type.toLowerCase()] ||
                                    "#6b7280",
                                };
                              })}
                              cx="50%"
                              cy="50%"
                              innerRadius={22}
                              outerRadius={48}
                              dataKey="value"
                              strokeWidth={0}
                            ></Pie>
                            <ChartTooltip content={<ChartTooltipContent />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </ChartContainer>
                      {/* Legend as compact pills grid */}
                      <div className="flex flex-wrap justify-center gap-1.5 mt-2">
                        {dashboardData.tests.byType.map((item) => {
                          const typeColorMap: Record<string, string> = {
                            browser: "#0ea5e9",
                            api: "#0d9488",
                            database: "#0891b2",
                            custom: "#2563eb",
                          };
                          const color = typeColorMap[item.type.toLowerCase()] || "#6b7280";
                          return (
                            <div
                              key={item.type}
                              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-muted/50"
                            >
                              <div
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <span className="text-xs text-muted-foreground capitalize">
                                {item.type}
                              </span>
                              <span className="text-xs font-semibold tabular-nums">
                                {item.count}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="h-43 flex items-center justify-center">
                      <div className="text-center">
                        <Code className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          No test types data
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Bottom Row Charts - 3 charts per row */}
            <div className="grid gap-4 lg:grid-cols-3">
              {/* Test Activity Trend Chart */}
              <Card className="h-full border-border/50 hover:shadow-md transition-shadow duration-200">
                <CardHeader className="pb-2 px-4 pt-4">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <div className="rounded-md bg-blue-500/10 p-1.5">
                      <Activity className="h-4 w-4 text-blue-500" />
                    </div>
                    Test Activity
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground/80">
                    Playground test executions last 30 days
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-4">
                  {dashboardData.tests.playgroundExecutions30d > 0 ? (
                    <ChartContainer config={chartConfig} className="h-43 w-full">
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
                    <div className="h-43 flex items-center justify-center">
                      <div className="text-center">
                        <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          No playground executions
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Job Activity Trend Chart */}
              <Card className="h-full border-border/50 hover:shadow-md transition-shadow duration-200">
                <CardHeader className="pb-2 px-4 pt-4">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <div className="rounded-md bg-purple-500/10 p-1.5">
                      <Activity className="h-4 w-4 text-purple-500" />
                    </div>
                    Job Activity
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground/80">
                    Job execution by trigger types last 30 days
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-4">
                  {dashboardData.jobs.total > 0 ? (
                    <ChartContainer config={chartConfig} className="h-43 w-full">
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
                    <div className="h-43 flex items-center justify-center">
                      <div className="text-center">
                        <CalendarClock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          No job activity
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Monitor Uptime Trend Chart */}
              <Card className="h-full border-border/50 hover:shadow-md transition-shadow duration-200">
                <CardHeader className="pb-2 px-4 pt-4">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <div className="rounded-md bg-emerald-500/10 p-1.5">
                      <TrendingUp className="h-4 w-4 text-emerald-500" />
                    </div>
                    Uptime Trend
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground/80">
                    Monitor uptime percentage last 30 days
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-4">
                  {dashboardData.monitors.total > 0 ? (
                    <ChartContainer config={chartConfig} className="h-43 w-full">
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
                    <div className="h-44 flex items-center justify-center">
                      <div className="text-center">
                        <TrendingUp className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          No uptime data
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value="k6">
        <K6AnalyticsTab
          selectedJob={k6SelectedJob ?? ""}
          onJobChange={setK6SelectedJob}
          period={k6Period}
          onPeriodChange={setK6Period}
          isComparingOpen={k6CompareOpen}
          onCompareOpenChange={setK6CompareOpen}
        />
      </TabsContent>

      <TabsContent value="playwright">
        <PlaywrightAnalyticsTab
          selectedJob={pwSelectedJob ?? ""}
          onJobChange={setPwSelectedJob}
          period={pwPeriod}
          onPeriodChange={setPwPeriod}
        />
      </TabsContent>
    </Tabs>
  );
}
