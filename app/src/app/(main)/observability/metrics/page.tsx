"use client";

import { useState, useEffect, useMemo } from "react";
import { useMetricsQuery } from "~/hooks/useObservability";
import { getTimeRangePreset } from "~/lib/observability";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  Filter,
  RefreshCw,
  Download,
  ArrowUp,
  ArrowDown,
  Minus
} from "lucide-react";

export default function MetricsPage() {
  const [timePreset, setTimePreset] = useState("last_1h");
  const [runTypeFilter, setRunTypeFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [timeRange, setTimeRange] = useState(() => getTimeRangePreset(timePreset));

  useEffect(() => {
    setTimeRange(getTimeRangePreset(timePreset));
  }, [timePreset]);

  const handleExport = (format: 'json' | 'csv') => {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `metrics-${activeTab}-${timestamp}.${format}`;

    if (format === 'json') {
      const data = activeTab === 'services' ? serviceMetrics : activeTab === 'endpoints' ? endpointMetrics : aggregateMetrics;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === 'csv') {
      let csv = '';

      if (activeTab === 'services') {
        const headers = ['Service', 'Requests', 'P95 Latency', 'P99 Latency', 'Errors', 'Error Rate', 'Trend'];
        const rows = serviceMetrics.map(s => [
          s.name,
          s.requests.toString(),
          s.p95.toString(),
          s.p99.toString(),
          s.errors.toString(),
          `${s.errorRate}%`,
          `${s.trend}%`,
        ]);
        csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      } else if (activeTab === 'endpoints') {
        const headers = ['Endpoint', 'Requests', 'P95 Latency', 'Errors', 'Error Rate'];
        const rows = endpointMetrics.map(e => [
          e.endpoint,
          e.requests.toString(),
          e.p95.toString(),
          e.errors.toString(),
          `${e.errorRate}%`,
        ]);
        csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      } else {
        // Overview metrics
        const headers = ['Metric', 'Value'];
        const rows = [
          ['Avg Latency', `${aggregateMetrics.avgLatency}ms`],
          ['P50 Latency', `${aggregateMetrics.p50Latency}ms`],
          ['P95 Latency', `${aggregateMetrics.p95Latency}ms`],
          ['P99 Latency', `${aggregateMetrics.p99Latency}ms`],
          ['Error Rate', `${aggregateMetrics.errorRate}%`],
          ['Throughput', `${aggregateMetrics.throughput} req/s`],
          ['Total Requests', aggregateMetrics.totalRequests.toString()],
          ['Active Services', aggregateMetrics.activeServices.toString()],
        ];
        csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      }

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const { data: _metricsData, isLoading: _isLoading } = useMetricsQuery(
    {
      timeRange,
      runType: runTypeFilter !== "all" ? [runTypeFilter as "playwright" | "k6" | "job" | "monitor"] : undefined,
      serviceName: serviceFilter !== "all" ? serviceFilter : undefined,
      interval: "1m",
    },
    { refetchInterval: autoRefresh ? 10000 : undefined }
  );

  // Mock aggregate metrics for display (would come from API in production)
  const aggregateMetrics = useMemo(() => ({
    avgLatency: 125,
    p50Latency: 98,
    p95Latency: 280,
    p99Latency: 450,
    errorRate: 1.2,
    throughput: 245,
    totalRequests: 14700,
    activeServices: 5,
  }), []);

  const serviceMetrics = useMemo(() => [
    { name: "supercheck-worker", requests: 5200, p95: 145, p99: 320, errors: 42, errorRate: 0.8, trend: -5.2 },
    { name: "nginx", requests: 4800, p95: 45, p99: 89, errors: 12, errorRate: 0.25, trend: 2.1 },
    { name: "postgres", requests: 3100, p95: 32, p99: 76, errors: 8, errorRate: 0.26, trend: -1.5 },
    { name: "redis", requests: 1600, p95: 12, p99: 24, errors: 2, errorRate: 0.12, trend: 0.3 },
  ], []);

  const endpointMetrics = useMemo(() => [
    { endpoint: "GET /api/tests", requests: 1850, p95: 95, errors: 18, errorRate: 0.97 },
    { endpoint: "POST /api/runs", requests: 1520, p95: 180, errors: 12, errorRate: 0.79 },
    { endpoint: "GET /api/monitors", requests: 1230, p95: 52, errors: 5, errorRate: 0.41 },
    { endpoint: "GET /api/jobs", requests: 980, p95: 68, errors: 8, errorRate: 0.82 },
    { endpoint: "POST /api/auth/login", requests: 720, p95: 145, errors: 3, errorRate: 0.42 },
  ], []);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Metrics</h1>
          <Badge variant="secondary" className="ml-2">
            {aggregateMetrics.activeServices} services
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
            <TabsList className="h-8">
              <TabsTrigger value="overview" className="text-xs h-6">Overview</TabsTrigger>
              <TabsTrigger value="services" className="text-xs h-6">Services</TabsTrigger>
              <TabsTrigger value="endpoints" className="text-xs h-6">Endpoints</TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4 mr-1" />
            Filters
          </Button>
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${autoRefresh ? "animate-spin" : ""}`} />
            Auto
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-1" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport('json')}>
                Export as JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('csv')}>
                Export as CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Filters bar */}
      {showFilters && (
        <div className="px-4 py-3 border-b bg-muted/30">
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-3">
              <Select value={timePreset} onValueChange={setTimePreset}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="last_15m">Last 15m</SelectItem>
                  <SelectItem value="last_1h">Last 1h</SelectItem>
                  <SelectItem value="last_6h">Last 6h</SelectItem>
                  <SelectItem value="last_24h">Last 24h</SelectItem>
                  <SelectItem value="last_7d">Last 7d</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-3">
              <Select value={runTypeFilter} onValueChange={setRunTypeFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All run types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="playwright">Playwright</SelectItem>
                  <SelectItem value="k6">K6</SelectItem>
                  <SelectItem value="job">Job</SelectItem>
                  <SelectItem value="monitor">Monitor</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-3">
              <Select value={serviceFilter} onValueChange={setServiceFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {serviceMetrics.map(s => (
                    <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "overview" && (
          <div className="p-4 space-y-4">
            {/* Key metrics grid */}
            <div className="grid grid-cols-4 gap-3">
              <MetricCard
                label="Avg Latency"
                value={`${aggregateMetrics.avgLatency}ms`}
                trend={-3.2}
                icon={<Activity className="h-4 w-4" />}
              />
              <MetricCard
                label="P95 Latency"
                value={`${aggregateMetrics.p95Latency}ms`}
                trend={2.1}
                icon={<TrendingUp className="h-4 w-4" />}
              />
              <MetricCard
                label="Error Rate"
                value={`${aggregateMetrics.errorRate}%`}
                trend={0.3}
                isError
                icon={<AlertTriangle className="h-4 w-4" />}
              />
              <MetricCard
                label="Throughput"
                value={`${aggregateMetrics.throughput} req/s`}
                trend={12.5}
                icon={<Activity className="h-4 w-4" />}
              />
            </div>

            {/* Secondary metrics */}
            <div className="grid grid-cols-4 gap-3">
              <SmallMetricCard label="P50" value={`${aggregateMetrics.p50Latency}ms`} />
              <SmallMetricCard label="P99" value={`${aggregateMetrics.p99Latency}ms`} />
              <SmallMetricCard label="Total Requests" value={aggregateMetrics.totalRequests.toLocaleString()} />
              <SmallMetricCard label="Active Services" value={aggregateMetrics.activeServices} />
            </div>

            {/* Top services by traffic */}
            <div className="border rounded-lg">
              <div className="px-4 py-2 border-b bg-muted/30">
                <h3 className="text-sm font-semibold">Top Services by Traffic</h3>
              </div>
              <div className="divide-y">
                {serviceMetrics.slice(0, 5).map((service, idx) => (
                  <ServiceRow key={service.name} service={service} rank={idx + 1} />
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "services" && (
          <div className="p-4">
            <div className="border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Service</th>
                    <th className="px-3 py-2 text-right font-medium">Requests</th>
                    <th className="px-3 py-2 text-right font-medium">P95 Latency</th>
                    <th className="px-3 py-2 text-right font-medium">P99 Latency</th>
                    <th className="px-3 py-2 text-right font-medium">Errors</th>
                    <th className="px-3 py-2 text-right font-medium">Error Rate</th>
                    <th className="px-3 py-2 text-right font-medium">Trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {serviceMetrics.map((service) => (
                    <tr key={service.name} className="hover:bg-accent/30">
                      <td className="px-3 py-2 font-medium">{service.name}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {service.requests.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right">{service.p95}ms</td>
                      <td className="px-3 py-2 text-right">{service.p99}ms</td>
                      <td className="px-3 py-2 text-right">{service.errors}</td>
                      <td className="px-3 py-2 text-right">
                        <Badge
                          variant={service.errorRate > 1 ? "destructive" : "secondary"}
                          className="h-5 text-[10px]"
                        >
                          {service.errorRate}%
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <TrendIndicator value={service.trend} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "endpoints" && (
          <div className="p-4">
            <div className="border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Endpoint</th>
                    <th className="px-3 py-2 text-right font-medium">Requests</th>
                    <th className="px-3 py-2 text-right font-medium">P95 Latency</th>
                    <th className="px-3 py-2 text-right font-medium">Errors</th>
                    <th className="px-3 py-2 text-right font-medium">Error Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {endpointMetrics.map((endpoint) => (
                    <tr key={endpoint.endpoint} className="hover:bg-accent/30">
                      <td className="px-3 py-2 font-mono">{endpoint.endpoint}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {endpoint.requests.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right">{endpoint.p95}ms</td>
                      <td className="px-3 py-2 text-right">{endpoint.errors}</td>
                      <td className="px-3 py-2 text-right">
                        <Badge
                          variant={endpoint.errorRate > 0.5 ? "destructive" : "secondary"}
                          className="h-5 text-[10px]"
                        >
                          {endpoint.errorRate}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  trend,
  isError = false,
  icon,
}: {
  label: string;
  value: string;
  trend?: number;
  isError?: boolean;
  icon: React.ReactNode;
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
    <div className="border rounded-lg p-3 bg-background">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {trend !== undefined && (
        <div className={`text-xs mt-1 flex items-center gap-1 ${trendColor}`}>
          {trend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          <span>{Math.abs(trend)}% vs last period</span>
        </div>
      )}
    </div>
  );
}

function SmallMetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border rounded-lg p-2 bg-muted/30">
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function ServiceRow({ service, rank }: { service: any; rank: number }) {
  return (
    <div className="px-4 py-2 flex items-center gap-4 hover:bg-accent/30 text-xs">
      <div className="w-6 text-muted-foreground font-semibold">#{rank}</div>
      <div className="flex-1 font-medium">{service.name}</div>
      <div className="text-muted-foreground">{service.requests.toLocaleString()} req</div>
      <div className="w-16 text-right">{service.p95}ms</div>
      <div className="w-16 text-right">
        <Badge
          variant={service.errorRate > 1 ? "destructive" : "secondary"}
          className="h-5 text-[10px]"
        >
          {service.errorRate}%
        </Badge>
      </div>
      <div className="w-16 text-right">
        <TrendIndicator value={service.trend} />
      </div>
    </div>
  );
}

function TrendIndicator({ value }: { value: number }) {
  if (value > 0) {
    return (
      <span className="flex items-center gap-1 text-green-600">
        <ArrowUp className="h-3 w-3" />
        {Math.abs(value)}%
      </span>
    );
  } else if (value < 0) {
    return (
      <span className="flex items-center gap-1 text-red-600">
        <ArrowDown className="h-3 w-3" />
        {Math.abs(value)}%
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <Minus className="h-3 w-3" />
      0%
    </span>
  );
}
