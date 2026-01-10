"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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

import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,

} from "@/components/ui/dialog";
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
} from "recharts";
import {
    Activity,
    TrendingUp,
    Zap,
    CheckCircle,
    XCircle,
    BarChart3,

    ArrowLeft,
    ArrowRightLeft,
    FileX,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import { triggerMonacoPreload } from "@/components/monaco-prefetcher";
import { cn } from "@/lib/utils";
import { K6Logo } from "@/components/logo/k6-logo";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { ReportViewer } from "@/components/shared/report-viewer";
import { AIK6AnalyzeButton, K6RunData } from "@/components/dashboard/ai-k6-analyze-button";

// Types
interface K6Job {
    id: string;
    name: string;
    status: string;
    lastRunAt: string | null;
}

interface K6RunMetrics {
    totalRequests: number | null;
    failedRequests: number | null;
    requestRate: number | null;
    avgResponseTimeMs: number | null;
    p95ResponseTimeMs: number | null;
    p99ResponseTimeMs: number | null;
    vusMax: number | null;
}

interface K6Run {
    id: string;
    runId: string;
    jobId: string | null;
    jobName: string | null;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    thresholdsPassed: boolean | null;
    metrics?: K6RunMetrics;  // Optional - may not exist in all responses
    delta?: {
        p95: number | null;
    };
}

interface K6Stats {
    totalRuns: number;
    passedRuns: number;
    failedRuns: number;
    passRate: number;
    avgP95: number;
    avgP99: number;
    avgResponseTime: number;
    avgRequestRate: number;
    totalRequests: number;
}

interface K6ChartData {
    date: string | null;
    p95: number | null;
    p99: number | null;
    avg: number | null;
    requestRate: number | null;
    status: string;
}

interface ComparisonRun {
    id: string;
    runId: string;
    jobId: string | null;
    jobName: string | null;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    thresholdsPassed: boolean | null;
    requestRate: number | null;
    reportS3Url: string | null;
    metrics: K6RunMetrics;
}

interface ComparisonDeltas {
    p95ResponseTimeMs: number | null;
    p95ResponseTimePercent: number | null;
    p99ResponseTimeMs: number | null;
    p99ResponseTimePercent: number | null;
    avgResponseTimeMs: number | null;
    avgResponseTimePercent: number | null;
    totalRequests: number | null;
    totalRequestsPercent: number | null;
    failedRequests: number | null;
    requestRate: number | null;
    requestRatePercent: number | null;
    vusMax: number | null;
    durationMs: number | null;
    durationPercent: number | null;
}

interface ComparisonData {
    left: ComparisonRun;
    right: ComparisonRun;
    deltas: ComparisonDeltas;
}

interface K6AnalyticsResponse {
    jobs: K6Job[];
    runs: K6Run[];
    stats: K6Stats;
    chartData: K6ChartData[];
    comparison: ComparisonData | null;
    period: number;
    selectedJobId: string | null;
}

// Comparison Row Component
function ComparisonRow({
    label,
    leftValue,
    rightValue,
    delta,
    deltaPercent,
    unit = "",
    lowerIsBetter = false,
}: {
    label: string;
    leftValue: string | number | null;
    rightValue: string | number | null;
    delta: number | null;
    deltaPercent: number | null;
    unit?: string;
    lowerIsBetter?: boolean;
}) {
    const formatVal = (val: string | number | null | unknown) => {
        if (val === null || val === undefined) return "-";
        if (typeof val === "number") return val.toLocaleString();
        if (typeof val === "object") return JSON.stringify(val); // Safety for [object Object] error
        return String(val);
    };

    const getDeltaClass = () => {
        if (delta === null || delta === 0) return "text-muted-foreground";
        if (lowerIsBetter) return delta < 0 ? "text-green-500" : "text-red-500";
        return delta > 0 ? "text-green-500" : "text-red-500";
    };

    return (
        <TableRow>
            <TableCell className="font-medium">{label}</TableCell>
            <TableCell className="text-center">{formatVal(leftValue)}{unit}</TableCell>
            <TableCell className="text-center">{formatVal(rightValue)}{unit}</TableCell>
            <TableCell className={cn("text-center font-mono", getDeltaClass())}>
                {delta !== null ? (
                    <>
                        {delta > 0 ? "+" : ""}{delta.toLocaleString()}{unit}
                        {deltaPercent !== null && (
                            <span className="text-xs ml-1 opacity-70">
                                ({deltaPercent > 0 ? "+" : ""}{deltaPercent}%)
                            </span>
                        )}
                    </>
                ) : "-"}
            </TableCell>
        </TableRow>
    );
}

interface K6AnalyticsTabProps {
    selectedJob: string;
    onJobChange: (jobId: string) => void;
    period: number;
    onPeriodChange: (period: number) => void;
    isComparingOpen?: boolean;
    onCompareOpenChange?: (open: boolean) => void;
    /** Callback to lift jobs data to parent - eliminates duplicate fetches */
    onJobsLoaded?: (jobs: Array<{ id: string; name: string }>) => void;
}

export function K6AnalyticsTab({
    selectedJob,
    onJobChange,
    period,
    onPeriodChange,
    isComparingOpen,
    onCompareOpenChange,
    onJobsLoaded,
}: K6AnalyticsTabProps) {
    const [data, setData] = useState<K6AnalyticsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [leftRunId, setLeftRunId] = useState<string | null>(null);
    const [rightRunId, setRightRunId] = useState<string | null>(null);
    const [isMounted, setIsMounted] = useState(false);
    const [showReportsView, setShowReportsView] = useState(false);

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

    // Use external state if provided, otherwise use internal state
    const [internalIsComparing, setInternalIsComparing] = useState(false);
    const isComparing = isComparingOpen !== undefined ? isComparingOpen : internalIsComparing;
    const setIsComparing = onCompareOpenChange ?? setInternalIsComparing;

    // Deduplicated runs - computed once when data changes
    const uniqueRuns = useMemo(() => {
        if (!data?.runs) return [];
        const runMap = new Map<string, K6Run>();
        for (const run of data.runs) {
            if (run.runId && !runMap.has(run.runId)) {
                runMap.set(run.runId, run);
            }
        }
        return Array.from(runMap.values());
    }, [data?.runs]);

    // Main data fetch - does NOT include comparison run IDs
    const fetchData = useCallback(async (signal?: AbortSignal) => {
        try {
            setLoading(true);
            const params = new URLSearchParams();
            params.set("period", period.toString());
            if (selectedJob !== "all" && selectedJob !== "") {
                params.set("jobId", selectedJob);
            }

            const response = await fetch(`/api/analytics/k6?${params.toString()}`, { signal });
            if (!response.ok) throw new Error("Failed to fetch K6 analytics");
            const result = await response.json();

            // Should not happen if aborted, but good safety
            if (!signal?.aborted) {
                setData(result);
                setError(null);
                // Lift jobs data to parent to eliminate duplicate fetches
                if (result.jobs && onJobsLoaded) {
                    onJobsLoaded(result.jobs);
                }
            }
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            if (!signal?.aborted) {
                setLoading(false);
            }
        }
    }, [period, selectedJob, onJobsLoaded]);

    // Separate comparison fetch - updates only comparison data without re-rendering charts
    const fetchComparison = useCallback(async (signal?: AbortSignal) => {
        if (!leftRunId || !rightRunId || selectedJob === "all" || selectedJob === "") return;

        try {
            const params = new URLSearchParams();
            params.set("period", period.toString());
            params.set("jobId", selectedJob);
            params.set("leftRunId", leftRunId);
            params.set("rightRunId", rightRunId);

            const response = await fetch(`/api/analytics/k6?${params.toString()}`, { signal });
            if (!response.ok) return;
            const result = await response.json();

            if (!signal?.aborted) {
                // Only update comparison data, not the entire data object
                setData(prev => prev ? { ...prev, comparison: result.comparison } : prev);
            }
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return;
            console.error("Failed to fetch comparison:", err);
        }
    }, [period, selectedJob, leftRunId, rightRunId]);

    useEffect(() => {
        const controller = new AbortController();
        fetchData(controller.signal);
        return () => controller.abort();
    }, [fetchData]);

    // Fetch comparison data when run selection changes
    useEffect(() => {
        if (leftRunId && rightRunId) {
            const controller = new AbortController();
            fetchComparison(controller.signal);
            return () => controller.abort();
        }
    }, [leftRunId, rightRunId, fetchComparison]);

    // Auto-select comparison runs when dialog opens and we have data
    useEffect(() => {
        // Start loading Monaco in background as soon as dialog opens
        if (isComparing) {
            triggerMonacoPreload();
        }

        if (!isComparing || uniqueRuns.length < 2) return;

        // Only auto-select if both are null (initial state when dialog opens)
        if (leftRunId === null && rightRunId === null) {
            // Select the two most recent runs (runs are sorted by startedAt desc)
            const firstRun = uniqueRuns[0]?.runId ?? null;
            const secondRun = uniqueRuns[1]?.runId ?? null;
            if (firstRun && secondRun && firstRun !== secondRun) {
                setRightRunId(firstRun);  // Most recent goes to right (compare)
                setLeftRunId(secondRun);   // Second most recent goes to left (baseline)
            }
        }
    }, [isComparing, uniqueRuns, leftRunId, rightRunId]);

    // Reset comparison when job changes
    useEffect(() => {
        setLeftRunId(null);
        setRightRunId(null);
        setShowReportsView(false);
        // Clear comparison data when job changes
        setData(prev => prev ? { ...prev, comparison: null } : prev);
    }, [selectedJob]);

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
                {/* Response Time Trend - Chart Skeleton */}
                <Card className="relative overflow-hidden">
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-2 text-base font-semibold">
                            <Skeleton className="h-7 w-7 rounded-md" />
                            <Skeleton className="h-5 w-36" />
                        </div>
                        <Skeleton className="h-4 w-48 mt-1" />
                    </CardHeader>
                    <CardContent className="pt-2">
                        <Skeleton className="h-[160px] w-full" />
                    </CardContent>
                </Card>
                {/* Request Rate Trend - Chart Skeleton */}
                <Card className="relative overflow-hidden">
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-2 text-base font-semibold">
                            <Skeleton className="h-7 w-7 rounded-md" />
                            <Skeleton className="h-5 w-36" />
                        </div>
                        <Skeleton className="h-4 w-48 mt-1" />
                    </CardHeader>
                    <CardContent className="pt-2">
                        <Skeleton className="h-[160px] w-full" />
                    </CardContent>
                </Card>
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
                title="No K6 Analytics Available"
                description="Analytics require completed job runs. Run a K6 job to start tracking performance metrics and trends."
                icon={<K6Logo size={64} />}
                action={
                    <Button asChild>
                        <Link href="/jobs">View Jobs</Link>
                    </Button>
                }
            />
        );
    }

    const chartConfig = {
        p95: { label: "P95 Response Time", color: "#3b82f6" },
        requestRate: { label: "Request Rate", color: "#22c55e" },
    };

    const compLeft = data.comparison?.left;
    const compRight = data.comparison?.right;
    const compDeltas = data.comparison?.deltas;

    // Check if a specific job is selected (enables comparison)
    const canCompare = selectedJob !== "all" && selectedJob !== "" && uniqueRuns.length >= 2;

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
                                <p className="text-sm font-medium text-muted-foreground">Avg P95 Response</p>
                                <div className="text-2xl font-bold tracking-tight truncate">{data.stats.avgP95}ms</div>
                                <p className="text-xs text-muted-foreground">95th percentile</p>
                            </div>
                            <div className="rounded-lg bg-purple-500/10 p-2 shrink-0">
                                <Zap className="h-4 w-4 text-purple-500" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="relative overflow-hidden">
                    <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                            <div className="space-y-2 min-w-0 flex-1">
                                <p className="text-sm font-medium text-muted-foreground">Avg Request Rate</p>
                                <div className="text-2xl font-bold tracking-tight truncate">{data.stats.avgRequestRate}/s</div>
                                <p className="text-xs text-muted-foreground">Requests per second</p>
                            </div>
                            <div className="rounded-lg bg-cyan-500/10 p-2 shrink-0">
                                <TrendingUp className="h-4 w-4 text-cyan-500" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="relative overflow-hidden">
                    <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                            <div className="space-y-2 min-w-0 flex-1">
                                <p className="text-sm font-medium text-muted-foreground">Avg Response Time</p>
                                <div className="text-2xl font-bold tracking-tight truncate">{data.stats.avgResponseTime ?? 0}ms</div>
                                <p className="text-xs text-muted-foreground">Mean latency</p>
                            </div>
                            <div className="rounded-lg bg-orange-500/10 p-2 shrink-0">
                                <Zap className="h-4 w-4 text-orange-500" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Response Time Trend Chart */}
            {data.chartData.length >= 1 && (
                <Card className="relative overflow-hidden">
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base font-semibold">
                            <div className="rounded-md bg-blue-500/10 p-1.5">
                                <BarChart3 className="h-4 w-4 text-blue-500" />
                            </div>
                            Response Time Trend
                        </CardTitle>
                        <CardDescription>P95 response time across runs</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-2">
                        {isMounted ? (
                            <ChartContainer config={chartConfig} className="h-[160px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={data.chartData}>
                                        <defs>
                                            <linearGradient id="k6P95Gradient" x1="0" y1="0" x2="0" y2="1">
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
                                            tickFormatter={(val) => `${val}ms`}
                                            domain={[0, (dataMax: number) => {
                                                // Ensure minimum domain height for visibility when all values are zero or very small
                                                const minDomain = 1;
                                                return dataMax <= 0 ? minDomain : Math.ceil(dataMax * 1.1);
                                            }]}
                                            allowDataOverflow={false}
                                        />
                                        <ChartTooltip content={<ChartTooltipContent />} />
                                        <Area
                                            type="monotone"
                                            dataKey="p95"
                                            stroke="#3b82f6"
                                            fill="url(#k6P95Gradient)"
                                            strokeWidth={2}
                                            connectNulls
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </ChartContainer>
                        ) : (
                            <Skeleton className="h-[160px] w-full" />
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Request Rate Trend Chart */}
            {data.chartData.length >= 1 && data.chartData.some(d => d.requestRate !== null && d.requestRate !== undefined) && (
                <Card className="relative overflow-hidden">
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base font-semibold">
                            <div className="rounded-md bg-green-500/10 p-1.5">
                                <TrendingUp className="h-4 w-4 text-green-500" />
                            </div>
                            Request Rate Trend
                        </CardTitle>
                        <CardDescription>Requests per second across runs</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-2">
                        {isMounted ? (
                            <ChartContainer config={chartConfig} className="h-[160px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={data.chartData}>
                                        <defs>
                                            <linearGradient id="k6RequestRateGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#22c55e" stopOpacity={0.05} />
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
                                            tickFormatter={(val) => `${val}/s`}
                                            domain={[0, (dataMax: number) => {
                                                // Ensure minimum domain height for visibility when all values are zero or very small
                                                const minDomain = 1;
                                                return dataMax <= 0 ? minDomain : Math.ceil(dataMax * 1.1);
                                            }]}
                                            allowDataOverflow={false}
                                        />
                                        <ChartTooltip content={<ChartTooltipContent />} />
                                        <Area
                                            type="monotone"
                                            dataKey="requestRate"
                                            stroke="#22c55e"
                                            fill="url(#k6RequestRateGradient)"
                                            strokeWidth={2}
                                            connectNulls
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </ChartContainer>
                        ) : (
                            <Skeleton className="h-[160px] w-full" />
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Run Comparison - Dialog controlled by parent */}
            {canCompare && (
                <Dialog open={isComparing} onOpenChange={setIsComparing}>
                    <DialogContent className="min-w-7xl overflow-hidden">
                        <DialogHeader className="flex flex-row items-start justify-between gap-4">
                            <div>
                                <DialogTitle className="flex items-center gap-2">
                                    <div className="rounded-md bg-blue-500/10 p-1.5">
                                        <ArrowRightLeft className="h-4 w-4 text-blue-500" />
                                    </div>
                                    Run Comparison
                                </DialogTitle>
                                <DialogDescription>Compare metrics between two runs</DialogDescription>
                            </div>
                            {/* Action buttons - show immediately when runs are selected */}
                            {leftRunId && rightRunId && (
                                <div className="flex items-center gap-2 mr-10 mt-5">
                                    {/* View k6 Reports button - always show when runs are selected */}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setShowReportsView(!showReportsView)}
                                        className="flex items-center gap-2 shrink-0"
                                    >
                                        {showReportsView ? (
                                            <>
                                                <ArrowLeft className="h-4 w-4" />
                                                Back to Metrics
                                            </>
                                        ) : (
                                            <>
                                                <K6Logo className="h-4 w-4" />
                                                View k6 Reports
                                            </>
                                        )}
                                    </Button>

                                    {/* AI Analyze button - show when comparison data is loaded */}
                                    {compLeft && compRight && compLeft.metrics && compRight.metrics && (
                                        <AIK6AnalyzeButton
                                            baselineRun={{
                                                runId: compLeft.runId,
                                                status: compLeft.status,
                                                startedAt: compLeft.startedAt,
                                                durationMs: compLeft.durationMs,
                                                requestRate: compLeft.requestRate,
                                                metrics: compLeft.metrics,
                                                reportS3Url: compLeft.reportS3Url,
                                            } as K6RunData}
                                            compareRun={{
                                                runId: compRight.runId,
                                                status: compRight.status,
                                                startedAt: compRight.startedAt,
                                                durationMs: compRight.durationMs,
                                                requestRate: compRight.requestRate,
                                                metrics: compRight.metrics,
                                                reportS3Url: compRight.reportS3Url,
                                            } as K6RunData}
                                            jobName={compLeft.jobName ?? undefined}
                                        />
                                    )}
                                </div>
                            )}
                        </DialogHeader>
                        <div className="space-y-4">
                            {/* Run selectors */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Baseline (Left)</label>
                                    <Select value={leftRunId ?? ""} onValueChange={setLeftRunId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select run" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {uniqueRuns
                                                .filter(r => r.runId !== rightRunId || r.runId === leftRunId)
                                                .map((run) => (
                                                    <SelectItem key={run.runId} value={run.runId}>
                                                        <span className="flex items-center gap-2">
                                                            {run.status === "passed" ? <CheckCircle className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                                                            {run.startedAt ? format(parseISO(run.startedAt), "MMM d, HH:mm") : "Unknown"}
                                                            <span className="text-muted-foreground text-xs">p95: {run.metrics?.p95ResponseTimeMs ?? "-"}ms</span>
                                                            <span className="text-muted-foreground text-xs">Run ID: {run.runId}</span>
                                                        </span>
                                                    </SelectItem>
                                                ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Compare To (Right)</label>
                                    <Select value={rightRunId ?? ""} onValueChange={setRightRunId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select run" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {uniqueRuns
                                                .filter(r => r.runId !== leftRunId || r.runId === rightRunId)
                                                .map((run) => (
                                                    <SelectItem key={run.runId} value={run.runId}>
                                                        <span className="flex items-center gap-2">
                                                            {run.status === "passed" ? <CheckCircle className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                                                            {run.startedAt ? format(parseISO(run.startedAt), "MMM d, HH:mm") : "Unknown"}
                                                            <span className="text-muted-foreground text-xs">p95: {run.metrics?.p95ResponseTimeMs ?? "-"}ms</span>
                                                            <span className="text-muted-foreground text-xs">Run ID: {run.runId}</span>
                                                        </span>
                                                    </SelectItem>
                                                ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* Loading skeleton when comparison data is being fetched */}
                            {(!compLeft || !compRight || !compDeltas) && leftRunId && rightRunId && (
                                <div className="border rounded-md animate-pulse">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Metric</TableHead>
                                                <TableHead className="text-center">Baseline</TableHead>
                                                <TableHead className="text-center">Compare</TableHead>
                                                <TableHead className="text-center">Delta</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {[...Array(8)].map((_, i) => (
                                                <TableRow key={i}>
                                                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                                                    <TableCell className="text-center"><Skeleton className="h-4 w-16 mx-auto" /></TableCell>
                                                    <TableCell className="text-center"><Skeleton className="h-4 w-16 mx-auto" /></TableCell>
                                                    <TableCell className="text-center"><Skeleton className="h-4 w-20 mx-auto" /></TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}

                            {/* Toggle between metrics view and reports view */}
                            {compLeft && compRight && compDeltas && compLeft.metrics && compRight.metrics && (
                                <>

                                    {/* Metrics comparison table */}
                                    {!showReportsView && (
                                        <div className="border rounded-md">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>Metric</TableHead>
                                                        <TableHead className="text-center">Baseline</TableHead>
                                                        <TableHead className="text-center">Compare</TableHead>
                                                        <TableHead className="text-center">Delta</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    <ComparisonRow label="P95 Response Time" leftValue={compLeft.metrics.p95ResponseTimeMs} rightValue={compRight.metrics.p95ResponseTimeMs} delta={compDeltas.p95ResponseTimeMs} deltaPercent={compDeltas.p95ResponseTimePercent} unit="ms" lowerIsBetter />
                                                    <ComparisonRow label="P99 Response Time" leftValue={compLeft.metrics.p99ResponseTimeMs} rightValue={compRight.metrics.p99ResponseTimeMs} delta={compDeltas.p99ResponseTimeMs} deltaPercent={compDeltas.p99ResponseTimePercent} unit="ms" lowerIsBetter />
                                                    <ComparisonRow label="Avg Response Time" leftValue={compLeft.metrics.avgResponseTimeMs} rightValue={compRight.metrics.avgResponseTimeMs} delta={compDeltas.avgResponseTimeMs} deltaPercent={compDeltas.avgResponseTimePercent} unit="ms" lowerIsBetter />
                                                    <ComparisonRow label="Total Requests" leftValue={compLeft.metrics.totalRequests} rightValue={compRight.metrics.totalRequests} delta={compDeltas.totalRequests} deltaPercent={compDeltas.totalRequestsPercent} />
                                                    <ComparisonRow label="Failed Requests" leftValue={compLeft.metrics.failedRequests} rightValue={compRight.metrics.failedRequests} delta={compDeltas.failedRequests} deltaPercent={null} lowerIsBetter />
                                                    <ComparisonRow label="Request Rate" leftValue={compLeft.requestRate?.toFixed(1) ?? null} rightValue={compRight.requestRate?.toFixed(1) ?? null} delta={compDeltas.requestRate} deltaPercent={compDeltas.requestRatePercent} unit="/s" />
                                                    <ComparisonRow label="Peak VUs" leftValue={compLeft.metrics.vusMax} rightValue={compRight.metrics.vusMax} delta={compDeltas.vusMax} deltaPercent={null} />
                                                    <ComparisonRow label="Duration" leftValue={compLeft.durationMs ? Math.round(compLeft.durationMs / 1000) : null} rightValue={compRight.durationMs ? Math.round(compRight.durationMs / 1000) : null} delta={compDeltas.durationMs ? Math.round(compDeltas.durationMs / 1000) : null} deltaPercent={compDeltas.durationPercent} unit="s" />
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )}

                                    {/* Side-by-side reports view */}
                                    {showReportsView && (
                                        <div className="grid grid-cols-2 gap-4 h-[600px]">
                                            {/* Left report */}
                                            <div className="flex flex-col border rounded-md overflow-hidden bg-background">
                                                <div className="flex-1 min-h-0 relative">
                                                    {compLeft.reportS3Url ? (
                                                        <ReportViewer
                                                            reportUrl={`/api/test-results/${encodeURIComponent(compLeft.runId)}/report.html`}
                                                            isK6Report={true}
                                                            hideFullscreenButton={true}
                                                            hideEmptyMessage={true}
                                                            containerClassName="w-full h-full"
                                                            iframeClassName="w-full h-full"
                                                        />
                                                    ) : (
                                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground p-4 text-center">
                                                            <div className="rounded-full bg-muted p-3 mb-2">
                                                                <FileX className="h-6 w-6" />
                                                            </div>
                                                            <p className="font-medium">No report available</p>
                                                            <p className="text-xs">This run does not have a generated HTML report.</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            {/* Right report */}
                                            <div className="flex flex-col border rounded-md overflow-hidden bg-background">
                                                <div className="flex-1 min-h-0 relative">
                                                    {compRight.reportS3Url ? (
                                                        <ReportViewer
                                                            reportUrl={`/api/test-results/${encodeURIComponent(compRight.runId)}/report.html`}
                                                            isK6Report={true}
                                                            hideFullscreenButton={true}
                                                            hideEmptyMessage={true}
                                                            containerClassName="w-full h-full"
                                                            iframeClassName="w-full h-full"
                                                        />
                                                    ) : (
                                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground p-4 text-center">
                                                            <div className="rounded-full bg-muted p-3 mb-2">
                                                                <FileX className="h-6 w-6" />
                                                            </div>
                                                            <p className="font-medium">No report available</p>
                                                            <p className="text-xs">This run does not have a generated HTML report.</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}
