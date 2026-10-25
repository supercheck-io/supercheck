"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useProjectContext } from "@/hooks/use-project-context";

import { Skeleton } from "@/components/ui/skeleton";

import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart";
import {
    ResponsiveContainer,
    XAxis,
    YAxis,
    AreaChart,
    Area,
    BarChart,
    Bar,
} from "recharts";
import {
    Activity,
    Clock,
    CheckCircle,
    XCircle,
    Calendar,
    Timer,
    BarChart3,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import { notPassedCaption } from "@/lib/dashboard/run-outcomes";
import { labelRunTrend } from "@/lib/dashboard/chart-data";

import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";



// Types
interface PlaywrightJob {
    id: string;
    name: string;
    status: string;
    lastRunAt: string | null;
}

interface PlaywrightRun {
    id: string;
    runId?: string;
    jobId: string | null;
    jobName: string | null;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    trigger: string;
    delta: {
        durationMs: number | null;
    };
}

interface PlaywrightStats {
    totalRuns: number;
    passedRuns: number;
    notPassedRuns: number;
    inFlightRuns: number;
    passRate: number;
    avgDurationMs: number;
    p95DurationMs: number;
    totalDurationMs: number;
    totalDurationMinutes: number;
}

interface FrequencyData {
    date: string;
    passed: number;
    failed: number;
    total: number;
}

interface ChartData {
    date: string | null;
    durationMs: number | null;
    status: string;
}

interface PlaywrightAnalyticsResponse {
    jobs: PlaywrightJob[];
    runs: PlaywrightRun[];
    stats: PlaywrightStats;
    frequencyData: FrequencyData[];
    chartData: ChartData[];
    period: number;
    selectedJobId: string | null;
}

// Format duration helper - handles 0 as a valid value
function formatDuration(ms: number | null | undefined): string {
    if (ms === null || ms === undefined) return "-";
    if (ms === 0) return "0s";
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}



interface PlaywrightAnalyticsTabProps {
    selectedJob: string;
    onJobChange: (jobId: string) => void;
    period: number;
    onPeriodChange: (period: number) => void;
    /** Callback to lift jobs data to parent - eliminates duplicate fetches */
    onJobsLoaded?: (jobs: Array<{ id: string; name: string }>) => void;
}

export function PlaywrightAnalyticsTab({
    selectedJob,
    onJobChange,
    period,
    onPeriodChange,
    onJobsLoaded,
}: PlaywrightAnalyticsTabProps) {
    const { currentProject, loading: isProjectLoading } = useProjectContext();
    const [data, setData] = useState<PlaywrightAnalyticsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isMounted, setIsMounted] = useState(false);

    // Ensure charts only render after mount AND after browser paint to avoid ResponsiveContainer sizing issues
    useEffect(() => {
        // Use requestAnimationFrame to wait for the next paint cycle
        const rafId = requestAnimationFrame(() => {
            // Then use a small timeout to ensure layout is stable
            const timeoutId = setTimeout(() => setIsMounted(true), 50);
            return () => clearTimeout(timeoutId);
        });
        return () => cancelAnimationFrame(rafId);
    }, []);

    const fetchData = useCallback(async (signal?: AbortSignal) => {
        if (isProjectLoading || !currentProject?.id) return;
        try {
            setLoading(true);
            const params = new URLSearchParams();
            params.set("period", period.toString());
            if (selectedJob && selectedJob !== "all") {
                params.set("jobId", selectedJob);
            }

            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (currentProject?.id) {
                headers["x-project-id"] = currentProject.id;
            }

            const response = await fetch(`/api/analytics/playwright?${params.toString()}`, {
                headers,
                signal
            });
            if (!response.ok) throw new Error("Failed to fetch Playwright analytics");
            const result = await response.json();

            if (!signal?.aborted) {
                setData(result);
                setError(null);
                // Lift jobs data to parent to eliminate duplicate fetches
                if (result.jobs && onJobsLoaded) {
                    onJobsLoaded(result.jobs);
                }
            }
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            if (!signal?.aborted) {
                setLoading(false);
            }
        }
    }, [period, selectedJob, onJobsLoaded, currentProject?.id, isProjectLoading]);

    useEffect(() => {
        const controller = new AbortController();
        fetchData(controller.signal);
        return () => controller.abort();
    }, [fetchData]);

    if (loading) {
        return (
            <div className="space-y-4">
                {/* Stats Cards Skeleton */}
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
                    {[...Array(6)].map((_, i) => (
                        <Card key={i} className="relative overflow-hidden">
                            <CardContent className="p-4">
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
                {/* Charts Skeleton - Stacked */}
                <div className="space-y-4">
                    {[...Array(2)].map((_, i) => (
                        <Card key={i} className="relative overflow-hidden">
                            <CardHeader className="pb-2">
                                <div className="flex items-center gap-2 text-base font-semibold">
                                    <Skeleton className="h-7 w-7 rounded-md" />
                                    <Skeleton className="h-5 w-32" />
                                </div>
                                <Skeleton className="h-4 w-48 mt-1" />
                            </CardHeader>
                            <CardContent className="pt-2">
                                <Skeleton className="h-[160px] w-full" />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <Card className="border-border/50">
                <CardContent className="pt-6">
                    <div className="text-center py-12">
                        <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
                        <p className="text-destructive mb-4">Error: {error}</p>
                        <Button variant="outline" onClick={() => fetchData()}>Retry</Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (!data || data.runs.length === 0) {
        return (
            <DashboardEmptyState
                title="No Playwright Analytics Available"
                description="Analytics require completed job runs. Run a Playwright job to start tracking test results and trends."
                icon={<PlaywrightLogo width={64} height={64} />}
                action={
                    <Button asChild>
                        <Link href="/jobs">View Jobs</Link>
                    </Button>
                }
            />
        );
    }

    const chartConfig = {
        passed: { label: "Passed", color: "var(--success)" },
        failed: { label: "Not passed", color: "var(--failure)" },
        durationMs: { label: "Duration (ms)", color: "var(--chart-1)" },
    };

    // Safe access to array fields with fallback to empty array
    const frequencyData = data.frequencyData ?? [];
    const filteredChartData = (data.chartData ?? []).filter(d => d.durationMs !== null && d.durationMs > 0);
    const trendLabels = labelRunTrend(filteredChartData);
    const chartData = filteredChartData.map((d, i) => ({ ...d, ...trendLabels[i] }));

    return (
        <div className="space-y-4">
            {/* Stats Cards */}
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
                <Card className="relative overflow-hidden">
                    <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                            <div className="space-y-2 min-w-0 flex-1">
                                <p className="text-sm font-medium text-muted-foreground">Total Runs</p>
                                <div className="text-2xl font-bold tracking-tight truncate">{data.stats.totalRuns}</div>
                                <p className="text-xs text-muted-foreground">Last {data.period} days</p>
                            </div>
                            <Activity className="h-4 w-4 text-muted-foreground shrink-0" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="relative overflow-hidden">
                    <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                            <div className="space-y-2 min-w-0 flex-1">
                                <p className="text-sm font-medium text-muted-foreground">Passed</p>
                                <div className="text-2xl font-bold tracking-tight truncate">{data.stats.passedRuns}</div>
                                <p className="text-xs text-muted-foreground">{data.stats.passRate}% pass rate</p>
                            </div>
                            <CheckCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="relative overflow-hidden">
                    <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                            <div className="space-y-2 min-w-0 flex-1">
                                <p className="text-sm font-medium text-muted-foreground">Not passed</p>
                                <div className="text-2xl font-bold tracking-tight truncate">{data.stats.notPassedRuns}</div>
                                <p className="text-xs text-muted-foreground">{notPassedCaption(data.stats.notPassedRuns)}</p>
                            </div>
                            <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="relative overflow-hidden">
                    <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                            <div className="space-y-2 min-w-0 flex-1">
                                <p className="text-sm font-medium text-muted-foreground">Avg Duration</p>
                                <div className="text-2xl font-bold tracking-tight truncate">{formatDuration(data.stats.avgDurationMs)}</div>
                                <p className="text-xs text-muted-foreground">Per run average</p>
                            </div>
                            <Timer className="h-4 w-4 text-muted-foreground shrink-0" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="relative overflow-hidden">
                    <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                            <div className="space-y-2 min-w-0 flex-1">
                                <p className="text-sm font-medium text-muted-foreground">P95 Duration</p>
                                <div className="text-2xl font-bold tracking-tight truncate">{formatDuration(data.stats.p95DurationMs)}</div>
                                <p className="text-xs text-muted-foreground">95th percentile</p>
                            </div>
                            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="relative overflow-hidden">
                    <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                            <div className="space-y-2 min-w-0 flex-1">
                                <p className="text-sm font-medium text-muted-foreground">Total Duration</p>
                                <div className="text-2xl font-bold tracking-tight truncate">{data.stats.totalDurationMinutes}m</div>
                                <p className="text-xs text-muted-foreground">Execution time</p>
                            </div>
                            <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Charts - Stacked Full Width */}
            <div className="space-y-4">
                {/* Run Frequency Chart */}
                {frequencyData.length > 0 && (
                    <Card className="relative overflow-hidden">
                        <CardHeader className="pb-2">
                            <CardTitle className="flex items-center gap-2 text-base font-semibold">
                                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                                Run Frequency
                            </CardTitle>
                            <CardDescription>Daily test run distribution</CardDescription>
                        </CardHeader>
                        <CardContent className="pt-2">
                            {isMounted ? (
                                <ChartContainer config={chartConfig} className="h-[160px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={frequencyData}>
                                            <XAxis
                                                dataKey="date"
                                                tickFormatter={(val) => format(parseISO(val), "MMM d")}
                                                interval="preserveStartEnd"
                                                minTickGap={24}
                                                tickLine={false}
                                                fontSize={11}
                                            />
                                            <YAxis fontSize={11} allowDecimals={false} />
                                            <ChartTooltip content={<ChartTooltipContent />} />
                                            <Bar dataKey="passed" stackId="a" fill="var(--success)" radius={[0, 0, 0, 0]} />
                                            <Bar dataKey="failed" stackId="a" fill="var(--failure)" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </ChartContainer>
                            ) : (
                                <Skeleton className="h-[160px] w-full" />
                            )}
                        </CardContent>
                    </Card>
                )
                }

                {/* Duration Trend Chart - Using blue color like K6 */}
                {
                    chartData.length > 0 && (
                        <Card className="relative overflow-hidden">
                            <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                                    <Timer className="h-4 w-4 text-muted-foreground shrink-0" />
                                    Execution Time Trend
                                </CardTitle>
                                <CardDescription>Test duration over time</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-2">
                                {isMounted ? (
                                    <ChartContainer config={chartConfig} className="h-[160px] w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={chartData}>
                                                <XAxis
                                                    dataKey="tickLabel"
                                                    interval="preserveStartEnd"
                                                    minTickGap={24}
                                                    tickLine={false}
                                                    fontSize={11}
                                                />
                                                <YAxis
                                                    fontSize={11}
                                                    tickFormatter={(val) => `${Math.round(val / 1000)}s`}
                                                />
                                                <ChartTooltip
                                                    content={
                                                        <ChartTooltipContent
                                                            labelFormatter={(_, payload) =>
                                                                (payload?.[0]?.payload as { tooltipLabel?: string } | undefined)?.tooltipLabel ?? ""
                                                            }
                                                        />
                                                    }
                                                />
                                                <Area
                                                    type="monotone"
                                                    dataKey="durationMs"
                                                    stroke="var(--chart-1)"
                                                    fill="var(--chart-1)"
                                                    fillOpacity={0.15}
                                                    strokeWidth={2}
                                                />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </ChartContainer>
                                ) : (
                                    <Skeleton className="h-[160px] w-full" />
                                )}
                            </CardContent>
                        </Card>
                    )
                }

                {/* Show placeholder if no duration data */}
                {
                    chartData.length === 0 && frequencyData.length > 0 && (
                        <Card className="border-border/50">
                            <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                                    <Timer className="h-4 w-4 text-muted-foreground shrink-0" />
                                    Execution Time Trend
                                </CardTitle>
                                <CardDescription>Test duration over time</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-2">
                                <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                                    <div className="text-center">
                                        <Timer className="h-8 w-8 mx-auto mb-2 opacity-30" />
                                        <p className="text-sm">No duration data available</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )
                }
            </div >
        </div >
    );
}
