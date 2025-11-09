"use client";

import { useState, useMemo } from "react";
import { Card } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Separator } from "~/components/ui/separator";
import {
  Clock,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  CheckCircle2,
  Activity,
  Layers,
} from "lucide-react";
import { formatDuration, buildSpanTree } from "~/lib/observability";
import type { Span, SpanTreeNode } from "~/types/observability";

interface TraceViewerProps {
  spans: Span[];
  showHeader?: boolean;
  defaultView?: "timeline" | "flamegraph" | "table";
  className?: string;
}

type TraceView = "timeline" | "flamegraph" | "table";

export function TraceViewer({
  spans,
  showHeader = true,
  defaultView = "timeline",
  className = "",
}: TraceViewerProps) {
  const [view, setView] = useState<TraceView>(defaultView);
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);

  const spanTree = useMemo(() => buildSpanTree(spans), [spans]);

  const totalDuration = useMemo(() => {
    if (spans.length === 0) return 0;
    const times = spans.map((s) => new Date(s.endTime).getTime());
    const starts = spans.map((s) => new Date(s.startTime).getTime());
    return Math.max(...times) - Math.min(...starts);
  }, [spans]);

  const errorCount = spans.filter((s) => s.statusCode === 2).length;

  if (spans.length === 0) {
    return (
      <Card className={className}>
        <div className="p-8 text-center">
          <Activity className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No trace data available</p>
        </div>
      </Card>
    );
  }

  return (
    <div className={className}>
      {showHeader && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Activity className="h-5 w-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold">Distributed Trace</h3>
              <p className="text-xs text-muted-foreground">
                {spans.length} spans • {formatDuration(totalDuration * 1_000_000)}
                {errorCount > 0 && (
                  <>
                    {" "}
                    •{" "}
                    <span className="text-destructive font-medium">
                      {errorCount} error{errorCount > 1 ? "s" : ""}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          <Tabs
            value={view}
            onValueChange={(value) => {
              if (
                value === "timeline" ||
                value === "flamegraph" ||
                value === "table"
              ) {
                setView(value);
              }
            }}
          >
            <TabsList className="h-8">
              <TabsTrigger value="timeline" className="text-xs h-6 px-2">
                <Layers className="h-3 w-3 mr-1" />
                Timeline
              </TabsTrigger>
              <TabsTrigger value="flamegraph" className="text-xs h-6 px-2">
                <Activity className="h-3 w-3 mr-1" />
                Flamegraph
              </TabsTrigger>
              <TabsTrigger value="table" className="text-xs h-6 px-2">
                Table
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      <Card className="border-border/50">
        <div className="p-4">
          {view === "timeline" && (
            <TraceTimeline
              spans={spans}
              spanTree={spanTree}
              onSpanSelect={setSelectedSpan}
            />
          )}
          {view === "flamegraph" && <Flamegraph spans={spans} />}
          {view === "table" && <SpanTable spans={spans} />}
        </div>

        {selectedSpan && (
          <div className="border-t bg-muted/20">
            <SpanDetails span={selectedSpan} onClose={() => setSelectedSpan(null)} />
          </div>
        )}
      </Card>
    </div>
  );
}

function TraceTimeline({
  spans,
  spanTree,
  onSpanSelect,
}: {
  spans: Span[];
  spanTree: SpanTreeNode[];
  onSpanSelect: (span: Span) => void;
}) {
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(
    new Set(spanTree.map((s) => s.spanId))
  );

  const flatSpans = useMemo(() => {
    const flat: { span: SpanTreeNode; depth: number }[] = [];
    const traverse = (nodes: SpanTreeNode[], depth = 0) => {
      nodes.forEach((node) => {
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
    setExpandedSpans((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  };

  const minTime = Math.min(...spans.map((s) => new Date(s.startTime).getTime()));
  const maxTime = Math.max(...spans.map((s) => new Date(s.endTime).getTime()));
  const totalDuration = maxTime - minTime;

  return (
    <div className="space-y-px">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 mb-2 border-b text-xs font-medium text-muted-foreground">
        <div className="w-64 flex-shrink-0">Span Name</div>
        <div className="flex-1">Timeline</div>
        <div className="w-24 text-right">Duration</div>
        <div className="w-32 text-right">Service</div>
      </div>

      {/* Timeline bars */}
      {flatSpans.map(({ span, depth }) => {
        const startOffset =
          ((new Date(span.startTime).getTime() - minTime) / totalDuration) * 100;
        const width = (span.duration / 1_000_000 / totalDuration) * 100;
        const hasChildren = span.children && span.children.length > 0;
        const isExpanded = expandedSpans.has(span.spanId);

        return (
          <div
            key={span.spanId}
            className="group hover:bg-accent/30 rounded transition-colors cursor-pointer"
            style={{ paddingLeft: `${depth * 12}px` }}
            onClick={() => onSpanSelect(span)}
          >
            <div className="flex items-center gap-2 py-1.5">
              <div className="w-64 flex items-center gap-1 flex-shrink-0">
                {hasChildren && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-4 w-4 p-0 hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(span.spanId);
                    }}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </Button>
                )}
                {!hasChildren && <div className="w-4" />}
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  {span.statusCode === 2 ? (
                    <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                  )}
                  <span className="text-xs truncate" title={span.name}>
                    {span.name}
                  </span>
                </div>
              </div>

              <div className="flex-1 relative h-6 min-w-0">
                <div
                  className={`absolute top-1/2 -translate-y-1/2 h-5 rounded ${
                    span.statusCode === 2
                      ? "bg-destructive"
                      : "bg-primary"
                  } opacity-80 group-hover:opacity-100 transition-opacity`}
                  style={{
                    left: `${startOffset}%`,
                    width: `${Math.max(width, 0.3)}%`,
                  }}
                  title={`${span.name}\n${formatDuration(span.duration)}`}
                />
              </div>

              <div className="w-24 text-right">
                <span className="text-xs text-muted-foreground font-mono">
                  {formatDuration(span.duration)}
                </span>
              </div>

              <div className="w-32 text-right">
                <Badge variant="outline" className="text-[10px] h-5">
                  {span.serviceName}
                </Badge>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Flamegraph({ spans }: { spans: Span[] }) {
  const [hoveredSpan, setHoveredSpan] = useState<Span | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const flamegraphData = useMemo(() => {
    if (!spans.length) return [];

    const tree = buildSpanTree(spans);
    const result: Array<{
      span: Span;
      depth: number;
      start: number;
      end: number;
    }> = [];

    const minTime = Math.min(...spans.map((s) => new Date(s.startTime).getTime()));
    const maxTime = Math.max(...spans.map((s) => new Date(s.endTime).getTime()));
    const totalDuration = maxTime - minTime;

    const traverse = (nodes: SpanTreeNode[], depth = 0) => {
      nodes.forEach((node) => {
        const spanStart = new Date(node.startTime).getTime();
        const spanEnd = new Date(node.endTime).getTime();

        result.push({
          span: node,
          depth,
          start: ((spanStart - minTime) / totalDuration) * 100,
          end: ((spanEnd - minTime) / totalDuration) * 100,
        });

        if (node.children?.length > 0) {
          traverse(node.children, depth + 1);
        }
      });
    };

    traverse(tree);
    return result;
  }, [spans]);

  const maxDepth = Math.max(...flamegraphData.map((d) => d.depth), 0);
  const rowHeight = 28;

  const serviceColors = useMemo(() => {
    const services = [...new Set(spans.map((s) => s.serviceName))];
    const colors = [
      "bg-blue-500",
      "bg-purple-500",
      "bg-green-500",
      "bg-orange-500",
      "bg-pink-500",
      "bg-cyan-500",
      "bg-yellow-500",
      "bg-indigo-500",
    ];
    return Object.fromEntries(
      services.map((s, i) => [s, colors[i % colors.length]])
    );
  }, [spans]);

  return (
    <div className="border rounded-lg bg-background overflow-hidden">
      <div className="border-b px-3 py-2 bg-muted/30">
        <div className="text-xs text-muted-foreground">
          Width represents duration • Height represents call depth
        </div>
      </div>

      <div className="relative overflow-x-auto">
        <div
          className="relative"
          style={{
            height: `${(maxDepth + 1) * rowHeight + 40}px`,
            minWidth: "800px",
          }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          }}
          onMouseLeave={() => setHoveredSpan(null)}
        >
          {/* Time axis */}
          <div className="absolute top-0 left-0 right-0 h-6 border-b bg-muted/20 flex items-center px-2 text-[10px] text-muted-foreground">
            <span>0ms</span>
            <span className="ml-auto">
              {flamegraphData.length > 0
                ? formatDuration(Math.max(...spans.map((s) => s.duration)))
                : "0ms"}
            </span>
          </div>

          {/* Flamegraph bars */}
          <div className="absolute top-6 left-0 right-0 bottom-0 px-2 py-2">
            {flamegraphData.map((item, idx) => {
              const width = item.end - item.start;
              const isError = item.span.statusCode === 2;
              const color = isError
                ? "bg-destructive"
                : serviceColors[item.span.serviceName] || "bg-muted";

              return (
                <div
                  key={idx}
                  className={`absolute ${color} hover:opacity-90 cursor-pointer transition-opacity rounded border border-background/20`}
                  style={{
                    left: `${item.start}%`,
                    width: `${width}%`,
                    top: `${item.depth * rowHeight}px`,
                    height: `${rowHeight - 4}px`,
                  }}
                  onMouseEnter={() => setHoveredSpan(item.span)}
                >
                  <div className="px-2 py-1 h-full flex items-center text-white text-[10px] font-medium truncate">
                    {item.span.name}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tooltip */}
          {hoveredSpan && (
            <div
              className="absolute z-50 bg-popover text-popover-foreground p-2 rounded-md shadow-lg border text-xs pointer-events-none"
              style={{
                left: `${Math.min(mousePos.x + 10, 700)}px`,
                top: `${mousePos.y + 10}px`,
                maxWidth: "280px",
              }}
            >
              <div className="font-semibold mb-1">{hoveredSpan.name}</div>
              <div className="space-y-0.5 text-[10px] text-muted-foreground">
                <div>Service: {hoveredSpan.serviceName}</div>
                <div>Duration: {formatDuration(hoveredSpan.duration)}</div>
                <div>
                  Status: {hoveredSpan.statusCode === 2 ? "Error" : "OK"}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="border-t px-3 py-2 bg-muted/10 flex flex-wrap gap-2">
        {Object.entries(serviceColors).map(([service, color]) => (
          <div key={service} className="flex items-center gap-1.5 text-[10px]">
            <div className={`w-3 h-3 rounded ${color}`} />
            <span>{service}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-[10px]">
          <div className="w-3 h-3 rounded bg-destructive" />
          <span>Error</span>
        </div>
      </div>
    </div>
  );
}

function SpanTable({ spans }: { spans: Span[] }) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 border-b">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-left font-medium">Name</th>
            <th className="px-3 py-2 text-left font-medium">Service</th>
            <th className="px-3 py-2 text-right font-medium">Duration</th>
            <th className="px-3 py-2 text-left font-medium">Started</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {spans.map((span) => (
            <tr key={span.spanId} className="hover:bg-accent/30">
              <td className="px-3 py-2">
                {span.statusCode === 2 ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                )}
              </td>
              <td className="px-3 py-2 font-medium">{span.name}</td>
              <td className="px-3 py-2">
                <Badge variant="outline" className="text-[10px]">
                  {span.serviceName}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {formatDuration(span.duration)}
              </td>
              <td className="px-3 py-2 text-muted-foreground font-mono">
                {new Date(span.startTime).toLocaleTimeString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpanDetails({ span, onClose }: { span: Span; onClose: () => void }) {
  return (
    <div className="p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-sm font-semibold mb-1">{span.name}</h4>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge
              variant={span.statusCode === 2 ? "destructive" : "default"}
              className="h-5"
            >
              {span.statusCode === 2 ? "Error" : "OK"}
            </Badge>
            <Separator orientation="vertical" className="h-4" />
            <Clock className="h-3 w-3" />
            <span>{formatDuration(span.duration)}</span>
            <Separator orientation="vertical" className="h-4" />
            <span>{span.serviceName}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7">
          Close
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 text-xs">
        <div>
          <div className="font-medium text-muted-foreground mb-1">Span ID</div>
          <div className="font-mono text-[10px] break-all">{span.spanId}</div>
        </div>
        <div>
          <div className="font-medium text-muted-foreground mb-1">Trace ID</div>
          <div className="font-mono text-[10px] break-all">{span.traceId}</div>
        </div>
        <div>
          <div className="font-medium text-muted-foreground mb-1">Started</div>
          <div>{new Date(span.startTime).toLocaleString()}</div>
        </div>
        <div>
          <div className="font-medium text-muted-foreground mb-1">Ended</div>
          <div>{new Date(span.endTime).toLocaleString()}</div>
        </div>
      </div>

      {Object.keys(span.attributes).length > 0 && (
        <div className="mt-4">
          <div className="font-medium text-xs text-muted-foreground mb-2">
            Attributes
          </div>
          <div className="space-y-1 text-xs">
            {Object.entries(span.attributes).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <span className="font-mono text-muted-foreground min-w-32">
                  {key}:
                </span>
                <span className="font-mono break-all">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
