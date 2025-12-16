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
    MousePointerClick,
    Workflow,
    BarChart3,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import Link from "next/link";

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
    failedRuns: number;
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

function formatTotalDuration(ms: number | null | undefined): string {
    if (ms === null || ms === undefined) return "0m";
    if (ms === 0) return "0m";
    const minutes = Math.round(ms / 60000);
    if (minutes === 0) return "<1m";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

interface PlaywrightAnalyticsTabProps {
    selectedJob: string;
    onJobChange: (jobId: string) => void;
    period: number;
    onPeriodChange: (period: number) => void;
}

export function PlaywrightAnalyticsTab({
    selectedJob,
    onJobChange,
    period,
    onPeriodChange,
}: PlaywrightAnalyticsTabProps) {
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

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams();
            params.set("period", period.toString());
            if (selectedJob !== "all") {
                params.set("jobId", selectedJob);
            }

            const response = await fetch(`/api/analytics/playwright?${params.toString()}`);
            if (!response.ok) throw new Error("Failed to fetch Playwright analytics");
            const result = await response.json();
            setData(result);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    }, [period, selectedJob]);

    useEffect(() => {
        fetchData();
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
                        <Button variant="outline" onClick={fetchData}>Retry</Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (!data || data.runs.length === 0) {
        return (
            <DashboardEmptyState
                title="No Playwright Data"
                description="Create a Playwright test first, then run the job to compare results or see the analytics."
                icon={<PlaywrightLogo className="h-12 w-12" />}
                action={
                    <Button asChild>
                        <Link href="/tests/create">Create Test</Link>
                    </Button>
                }
            />
        );
    }

    const chartConfig = {
        passed: { label: "Passed", color: "#22c55e" },
        failed: { label: "Failed", color: "#ef4444" },
        durationMs: { label: "Duration (ms)", color: "#3b82f6" },
    };

    // Safe access to array fields with fallback to empty array
    const frequencyData = data.frequencyData ?? [];
    const chartData = (data.chartData ?? []).filter(d => d.durationMs !== null && d.durationMs > 0);

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
                            <div className="rounded-lg bg-blue-500/10 p-2 shrink-0">
                                <Activity className="h-4 w-4 text-blue-500" />
                            </div>
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
                            <div className="rounded-lg bg-green-500/10 p-2 shrink-0">
                                <CheckCircle className="h-4 w-4 text-green-500" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="relative overflow-hidden">
                    <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                            <div className="space-y-2 min-w-0 flex-1">
                                <p className="text-sm font-medium text-muted-foreground">Failed</p>
                                <div className="text-2xl font-bold tracking-tight truncate">{data.stats.failedRuns}</div>
                                <p className="text-xs text-muted-foreground">{data.stats.failedRuns > 0 ? "Needs attention" : "All passing"}</p>
                            </div>
                            <div className="rounded-lg bg-red-500/10 p-2 shrink-0">
                                <XCircle className="h-4 w-4 text-red-500" />
                            </div>
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
                            <div className="rounded-lg bg-purple-500/10 p-2 shrink-0">
                                <Timer className="h-4 w-4 text-purple-500" />
                            </div>
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
                            <div className="rounded-lg bg-cyan-500/10 p-2 shrink-0">
                                <Clock className="h-4 w-4 text-cyan-500" />
                            </div>
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
                            <div className="rounded-lg bg-orange-500/10 p-2 shrink-0">
                                <BarChart3 className="h-4 w-4 text-orange-500" />
                            </div>
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
                                <div className="rounded-md bg-green-500/10 p-1.5">
                                    <Calendar className="h-4 w-4 text-green-500" />
                                </div>
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
                                                tick={{ fontSize: 11, fill: '#888' }}
                                                fontSize={11}
                                            />
                                            <YAxis tick={{ fontSize: 11, fill: '#888' }} fontSize={11} />
                                            <ChartTooltip content={<ChartTooltipContent />} />
                                            <Bar dataKey="passed" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
                                            <Bar dataKey="failed" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
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
                                    <div className="rounded-md bg-blue-500/10 p-1.5">
                                        <Timer className="h-4 w-4 text-blue-500" />
                                    </div>
                                    Execution Time Trend
                                </CardTitle>
                                <CardDescription>Test duration over time</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-2">
                                {isMounted ? (
                                    <ChartContainer config={chartConfig} className="h-[160px] w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={chartData}>
                                                <defs>
                                                    <linearGradient id="pwDurationGradient" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                                                    </linearGradient>
                                                </defs>
                                                <XAxis
                                                    dataKey="date"
                                                    tickFormatter={(val) => val ? format(parseISO(val), "MMM d") : ""}
                                                    tick={{ fontSize: 11, fill: '#888' }}
                                                    fontSize={11}
                                                />
                                                <YAxis
                                                    tick={{ fontSize: 11, fill: '#888' }}
                                                    fontSize={11}
                                                    tickFormatter={(val) => `${Math.round(val / 1000)}s`}
                                                />
                                                <ChartTooltip content={<ChartTooltipContent />} />
                                                <Area
                                                    type="monotone"
                                                    dataKey="durationMs"
                                                    stroke="#3b82f6"
                                                    fill="url(#pwDurationGradient)"
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
                                    <div className="rounded-md bg-blue-500/10 p-1.5">
                                        <Timer className="h-4 w-4 text-blue-500" />
                                    </div>
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
