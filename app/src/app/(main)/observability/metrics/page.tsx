"use client";

import { useState } from "react";
import { useMetricsQuery } from "~/hooks/useObservability";
import { getTimeRangePreset } from "~/lib/observability";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { TrendingUp, TrendingDown, Activity, AlertTriangle } from "lucide-react";

export default function MetricsPage() {
  const [timePreset, setTimePreset] = useState("last_1h");
  const timeRange = getTimeRangePreset(timePreset);

  const { data: _metricsData, isLoading: _isLoading } = useMetricsQuery({
    timeRange,
    interval: "1m",
  });

  // Mock aggregate metrics for display
  const aggregateMetrics = {
    avgLatency: 125,
    p95Latency: 280,
    p99Latency: 450,
    errorRate: 1.2,
    throughput: 245,
    totalRequests: 14700,
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Metrics</h1>
          <p className="text-muted-foreground">Performance metrics and analytics</p>
        </div>
      </div>

      {/* Time Range Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="w-64">
            <label className="text-sm font-medium mb-2 block">Time Range</label>
            <Select value={timePreset} onValueChange={setTimePreset}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last_15m">Last 15 minutes</SelectItem>
                <SelectItem value="last_1h">Last hour</SelectItem>
                <SelectItem value="last_6h">Last 6 hours</SelectItem>
                <SelectItem value="last_24h">Last 24 hours</SelectItem>
                <SelectItem value="last_7d">Last 7 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          title="Avg Latency"
          value={`${aggregateMetrics.avgLatency}ms`}
          icon={<Activity className="h-5 w-5" />}
          trend={-5.2}
          trendLabel="vs last period"
        />
        <MetricCard
          title="P95 Latency"
          value={`${aggregateMetrics.p95Latency}ms`}
          icon={<TrendingUp className="h-5 w-5" />}
          trend={3.1}
          trendLabel="vs last period"
        />
        <MetricCard
          title="P99 Latency"
          value={`${aggregateMetrics.p99Latency}ms`}
          icon={<TrendingUp className="h-5 w-5" />}
          trend={-2.4}
          trendLabel="vs last period"
        />
        <MetricCard
          title="Error Rate"
          value={`${aggregateMetrics.errorRate}%`}
          icon={<AlertTriangle className="h-5 w-5" />}
          trend={0.3}
          trendLabel="vs last period"
          isError
        />
        <MetricCard
          title="Throughput"
          value={`${aggregateMetrics.throughput} req/s`}
          icon={<Activity className="h-5 w-5" />}
          trend={12.5}
          trendLabel="vs last period"
        />
        <MetricCard
          title="Total Requests"
          value={aggregateMetrics.totalRequests.toLocaleString()}
          icon={<Activity className="h-5 w-5" />}
        />
      </div>

      {/* Service Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Service Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <ServicePerformanceRow
              service="supercheck-worker"
              latency={145}
              errorRate={0.8}
              throughput={120}
            />
            <ServicePerformanceRow
              service="nginx"
              latency={45}
              errorRate={0.2}
              throughput={85}
            />
            <ServicePerformanceRow
              service="postgres"
              latency={32}
              errorRate={0.1}
              throughput={40}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon,
  trend,
  trendLabel,
  isError = false,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  trend?: number;
  trendLabel?: string;
  isError?: boolean;
}) {
  const trendColor = !trend
    ? "text-muted-foreground"
    : trend > 0
    ? isError
      ? "text-red-500"
      : "text-green-500"
    : isError
    ? "text-green-500"
    : "text-red-500";

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">{icon}</div>
        </div>
        <div className="mt-4">
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-sm text-muted-foreground">{title}</div>
        </div>
        {trend !== undefined && (
          <div className={`text-xs mt-2 flex items-center gap-1 ${trendColor}`}>
            {trend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            <span>
              {Math.abs(trend)}% {trendLabel}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ServicePerformanceRow({
  service,
  latency,
  errorRate,
  throughput,
}: {
  service: string;
  latency: number;
  errorRate: number;
  throughput: number;
}) {
  return (
    <div className="flex items-center justify-between border rounded-lg p-4">
      <div className="font-medium">{service}</div>
      <div className="flex items-center gap-6 text-sm">
        <div>
          <div className="text-muted-foreground">Latency</div>
          <div className="font-medium">{latency}ms</div>
        </div>
        <div>
          <div className="text-muted-foreground">Error Rate</div>
          <div className="font-medium">{errorRate}%</div>
        </div>
        <div>
          <div className="text-muted-foreground">Throughput</div>
          <div className="font-medium">{throughput} req/s</div>
        </div>
      </div>
    </div>
  );
}
