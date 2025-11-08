"use client";

import { useState, useMemo } from "react";
import { useTracesQuery, useTraceQuery } from "~/hooks/useObservability";
import { getTimeRangePreset, formatDuration, buildSpanTree } from "~/lib/observability";
import { Card } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Separator } from "~/components/ui/separator";
import {
  Activity,
  Clock,
  AlertCircle,
  CheckCircle2,
  Search,
  Filter,
  RefreshCw,
  Download,
  ChevronRight,
  ChevronDown,
  Flame,
  List,
  LayoutGrid
} from "lucide-react";
import type { Trace, Span } from "~/types/observability";

export default function TracesPage() {
  const [timePreset, setTimePreset] = useState("last_1h");
  const [runTypeFilter, setRunTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [view, setView] = useState<"timeline" | "flamegraph" | "table">("timeline");
  const [showFilters, setShowFilters] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const timeRange = getTimeRangePreset(timePreset);

  const { data: tracesData, isLoading, refetch } = useTracesQuery(
    {
      timeRange,
      runType: runTypeFilter ? [runTypeFilter as "playwright" | "k6" | "job" | "monitor"] : undefined,
      status: statusFilter ? [parseInt(statusFilter)] : undefined,
      search: searchQuery || undefined,
      limit: 100,
    },
    { refetchInterval: autoRefresh ? 5000 : false }
  );

  const { data: selectedTrace } = useTraceQuery(selectedTraceId);

  const spanTree = useMemo(() => {
    if (!selectedTrace?.spans) return [];
    return buildSpanTree(selectedTrace.spans);
  }, [selectedTrace]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Traces</h1>
          <Badge variant="secondary" className="ml-2">
            {tracesData?.total || 0} results
          </Badge>
        </div>

        <div className="flex items-center gap-2">
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
            Auto-refresh
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
        </div>
      </div>

      {/* Filters bar */}
      {showFilters && (
        <div className="px-4 py-3 border-b bg-muted/30">
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-2">
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

            <div className="col-span-2">
              <Select value={runTypeFilter} onValueChange={setRunTypeFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All run types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All types</SelectItem>
                  <SelectItem value="playwright">Playwright</SelectItem>
                  <SelectItem value="k6">K6</SelectItem>
                  <SelectItem value="job">Job</SelectItem>
                  <SelectItem value="monitor">Monitor</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All statuses</SelectItem>
                  <SelectItem value="1">Success</SelectItem>
                  <SelectItem value="2">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-6 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search traces by name, ID, or attributes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Traces list */}
        <div className="w-96 border-r flex flex-col">
          <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
            <span className="text-xs font-medium">Trace Results</span>
            <div className="flex gap-1">
              <Button
                variant={view === "table" ? "secondary" : "ghost"}
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setView("table")}
              >
                <List className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={view === "timeline" ? "secondary" : "ghost"}
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setView("timeline")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                Loading traces...
              </div>
            ) : tracesData?.data.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                No traces found
              </div>
            ) : (
              <div className="divide-y">
                {tracesData?.data.map((trace) => (
                  <CompactTraceCard
                    key={trace.traceId}
                    trace={trace}
                    isSelected={trace.traceId === selectedTraceId}
                    onClick={() => setSelectedTraceId(trace.traceId)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Trace details */}
        <div className="flex-1 flex flex-col bg-muted/20">
          {!selectedTraceId ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Select a trace to view details
            </div>
          ) : selectedTrace ? (
            <>
              {/* Trace header */}
              <div className="px-4 py-3 border-b bg-background">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold">
                        {selectedTrace.scTestName || selectedTrace.traceId}
                      </h2>
                      <Badge variant={selectedTrace.errorCount > 0 ? "destructive" : "default"} className="h-5 text-xs">
                        {selectedTrace.errorCount > 0 ? "Error" : "Success"}
                      </Badge>
                      {selectedTrace.scRunType && (
                        <Badge variant="outline" className="h-5 text-xs">
                          {selectedTrace.scRunType}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDuration(selectedTrace.duration)}
                      </span>
                      <span>{selectedTrace.spanCount} spans</span>
                      <span>{selectedTrace.serviceNames.length} services</span>
                      <span>{new Date(selectedTrace.startedAt).toLocaleString()}</span>
                    </div>
                  </div>

                  <Tabs value={view} onValueChange={(v) => setView(v as any)} className="w-auto">
                    <TabsList className="h-8">
                      <TabsTrigger value="timeline" className="text-xs h-6">Timeline</TabsTrigger>
                      <TabsTrigger value="flamegraph" className="text-xs h-6">Flamegraph</TabsTrigger>
                      <TabsTrigger value="table" className="text-xs h-6">Table</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </div>

              {/* Trace view */}
              <div className="flex-1 overflow-auto p-4">
                {view === "timeline" && <TraceTimeline spans={selectedTrace.spans} />}
                {view === "flamegraph" && <FlamegraphPlaceholder />}
                {view === "table" && <SpanTable spans={selectedTrace.spans} />}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Loading trace...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CompactTraceCard({ trace, isSelected, onClick }: {
  trace: Trace;
  isSelected: boolean;
  onClick: () => void
}) {
  const statusIcon = trace.errorCount > 0 ? (
    <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
  ) : (
    <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
  );

  return (
    <div
      className={`px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors text-xs ${
        isSelected ? "bg-accent" : ""
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <div className="mt-1.5">{statusIcon}</div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="font-medium truncate">
            {trace.scTestName || `Trace ${trace.traceId.slice(0, 8)}`}
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(trace.duration)}
            </span>
            <Separator orientation="vertical" className="h-3" />
            <span>{trace.spanCount}sp</span>
            {trace.scRunType && (
              <>
                <Separator orientation="vertical" className="h-3" />
                <span className="truncate">{trace.scRunType}</span>
              </>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {new Date(trace.startedAt).toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  );
}

function TraceTimeline({ spans }: { spans: Span[] }) {
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(new Set());

  const spanTree = useMemo(() => buildSpanTree(spans), [spans]);
  const flatSpans = useMemo(() => {
    const flat: { span: any; depth: number }[] = [];
    const traverse = (nodes: any[], depth = 0) => {
      nodes.forEach(node => {
        flat.push({ span: node, depth });
        if (expandedSpans.has(node.spanId)) {
          traverse(node.children, depth + 1);
        }
      });
    };
    traverse(spanTree);
    return flat;
  }, [spanTree, expandedSpans]);

  const toggleExpand = (spanId: string) => {
    setExpandedSpans(prev => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  };

  const minTime = Math.min(...spans.map(s => new Date(s.startTime).getTime()));
  const maxTime = Math.max(...spans.map(s => new Date(s.endTime).getTime()));
  const totalDuration = maxTime - minTime;

  return (
    <div className="space-y-0.5">
      {flatSpans.map(({ span, depth }) => {
        const startOffset = ((new Date(span.startTime).getTime() - minTime) / totalDuration) * 100;
        const width = (span.duration / 1_000_000 / totalDuration) * 100;
        const hasChildren = span.children && span.children.length > 0;
        const isExpanded = expandedSpans.has(span.spanId);

        return (
          <div
            key={span.spanId}
            className="group hover:bg-accent/30 rounded transition-colors"
            style={{ paddingLeft: `${depth * 16}px` }}
          >
            <div className="flex items-center gap-2 py-1">
              <div className="w-48 flex items-center gap-1 flex-shrink-0">
                {hasChildren && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-4 w-4 p-0"
                    onClick={() => toggleExpand(span.spanId)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </Button>
                )}
                <span className="text-xs truncate" title={span.name}>
                  {span.name}
                </span>
              </div>

              <div className="flex-1 relative h-6">
                <div
                  className={`absolute top-1/2 -translate-y-1/2 h-4 rounded ${
                    span.statusCode === 2 ? "bg-red-500" : "bg-blue-500"
                  } opacity-80 hover:opacity-100 transition-opacity`}
                  style={{
                    left: `${startOffset}%`,
                    width: `${Math.max(width, 0.5)}%`,
                  }}
                  title={`${span.name}\n${formatDuration(span.duration)}`}
                />
              </div>

              <div className="w-24 text-right">
                <span className="text-xs text-muted-foreground">
                  {formatDuration(span.duration)}
                </span>
              </div>

              <div className="w-32 text-right">
                <span className="text-xs text-muted-foreground truncate">
                  {span.serviceName}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SpanTable({ spans }: { spans: Span[] }) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 border-b">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Name</th>
            <th className="px-3 py-2 text-left font-medium">Service</th>
            <th className="px-3 py-2 text-left font-medium">Duration</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {spans.map((span) => (
            <tr key={span.spanId} className="hover:bg-accent/30">
              <td className="px-3 py-2">{span.name}</td>
              <td className="px-3 py-2">{span.serviceName}</td>
              <td className="px-3 py-2">{formatDuration(span.duration)}</td>
              <td className="px-3 py-2">
                <Badge variant={span.statusCode === 2 ? "destructive" : "default"} className="h-5 text-xs">
                  {span.statusCode === 2 ? "Error" : "OK"}
                </Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {new Date(span.startTime).toLocaleTimeString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlamegraphPlaceholder() {
  return (
    <div className="flex items-center justify-center h-64 border rounded-lg bg-muted/20">
      <div className="text-center space-y-2">
        <Flame className="h-12 w-12 mx-auto text-muted-foreground" />
        <div className="text-sm font-medium">Flamegraph View</div>
        <div className="text-xs text-muted-foreground">Coming soon</div>
      </div>
    </div>
  );
}
