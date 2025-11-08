"use client";

import { useState } from "react";
import { useTracesQuery, useTraceQuery } from "~/hooks/useObservability";
import { getTimeRangePreset, formatDuration } from "~/lib/observability";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";

import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Activity, Clock, AlertCircle, CheckCircle2, Search } from "lucide-react";
import type { Trace } from "~/types/observability";

export default function TracesPage() {
  const [timePreset, setTimePreset] = useState("last_1h");
  const [runTypeFilter, setRunTypeFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  const timeRange = getTimeRangePreset(timePreset);

  const { data: tracesData, isLoading } = useTracesQuery({
    timeRange,
    runType: runTypeFilter ? [runTypeFilter as "playwright" | "k6" | "job" | "monitor"] : undefined,
    search: searchQuery || undefined,
    limit: 50,
  });

  const { data: selectedTrace } = useTraceQuery(selectedTraceId);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Traces</h1>
          <p className="text-muted-foreground">Distributed tracing for your tests and monitors</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
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

            <div>
              <label className="text-sm font-medium mb-2 block">Run Type</label>
              <Select value={runTypeFilter} onValueChange={setRunTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All types" />
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

            <div className="md:col-span-2">
              <label className="text-sm font-medium mb-2 block">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search traces..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Traces List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Traces ({tracesData?.total || 0})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading traces...</div>
            ) : tracesData?.data.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No traces found</div>
            ) : (
              <div className="space-y-2">
                {tracesData?.data.map((trace) => (
                  <TraceCard
                    key={trace.traceId}
                    trace={trace}
                    isSelected={trace.traceId === selectedTraceId}
                    onClick={() => setSelectedTraceId(trace.traceId)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Trace Details */}
        <Card>
          <CardHeader>
            <CardTitle>Trace Details</CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedTraceId ? (
              <div className="text-center py-8 text-muted-foreground">
                Select a trace to view details
              </div>
            ) : selectedTrace ? (
              <Tabs defaultValue="spans" className="w-full">
                <TabsList>
                  <TabsTrigger value="spans">Spans</TabsTrigger>
                  <TabsTrigger value="attributes">Attributes</TabsTrigger>
                </TabsList>
                <TabsContent value="spans" className="space-y-2 mt-4">
                  <div className="text-sm space-y-1 mb-4">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Duration:</span>
                      <span className="font-mono">{formatDuration(selectedTrace.duration)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Spans:</span>
                      <span>{selectedTrace.spanCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Services:</span>
                      <span>{selectedTrace.serviceNames.join(", ")}</span>
                    </div>
                  </div>
                  {selectedTrace.spans.map((span, idx) => (
                    <div key={span.spanId} className="border rounded p-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{span.name}</span>
                        <Badge variant={span.statusCode === 2 ? "destructive" : "default"} className="text-xs">
                          {formatDuration(span.duration)}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {span.serviceName}
                      </div>
                    </div>
                  ))}
                </TabsContent>
                <TabsContent value="attributes" className="mt-4">
                  <div className="space-y-2 text-sm">
                    {Object.entries(selectedTrace.attributes || {}).map(([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span className="text-muted-foreground font-mono">{key}:</span>
                        <span className="font-mono text-right break-all">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            ) : (
              <div className="text-center py-8 text-muted-foreground">Loading trace...</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TraceCard({ trace, isSelected, onClick }: { trace: Trace; isSelected: boolean; onClick: () => void }) {
  const statusIcon = trace.errorCount > 0 ? (
    <AlertCircle className="h-4 w-4 text-destructive" />
  ) : (
    <CheckCircle2 className="h-4 w-4 text-green-500" />
  );

  return (
    <div
      className={`border rounded-lg p-3 cursor-pointer transition-colors hover:bg-accent ${
        isSelected ? "bg-accent" : ""
      }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {statusIcon}
          <span className="font-medium text-sm">{trace.scTestName || trace.traceId.slice(0, 8)}</span>
        </div>
        <Badge variant="outline" className="text-xs">
          {trace.scRunType}
        </Badge>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDuration(trace.duration)}
        </div>
        <div className="flex items-center gap-1">
          <Activity className="h-3 w-3" />
          {trace.spanCount} spans
        </div>
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {new Date(trace.startedAt).toLocaleString()}
      </div>
    </div>
  );
}
