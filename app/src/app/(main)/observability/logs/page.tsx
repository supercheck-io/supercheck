"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLogsQuery } from "~/hooks/useObservability";
import { getTimeRangePreset } from "~/lib/observability";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  FileText,
  Search,
  Filter,
  RefreshCw,
  Download,
  ExternalLink,
  Copy,
  Check
} from "lucide-react";
import type { Log } from "~/types/observability";
import { useVirtualizer } from "@tanstack/react-virtual";

const LEVEL_COLORS = {
  TRACE: "bg-gray-500",
  DEBUG: "bg-blue-500",
  INFO: "bg-green-500",
  WARN: "bg-yellow-500",
  ERROR: "bg-red-500",
  FATAL: "bg-purple-500",
} as const;

export default function LogsPage() {
  const router = useRouter();
  const [timePreset, setTimePreset] = useState("last_24h");
  const [levelFilter, setLevelFilter] = useState<string>("");
  const [serviceFilter, setServiceFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedLog, setSelectedLog] = useState<Log | null>(null);
  const [timeRange, setTimeRange] = useState(() => getTimeRangePreset(timePreset));

  useEffect(() => {
    setTimeRange(getTimeRangePreset(timePreset));
  }, [timePreset]);

  const handleExport = (format: 'json' | 'csv') => {
    if (!logsData?.data) return;

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `logs-${timestamp}.${format}`;

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(logsData.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === 'csv') {
      // CSV headers
      const headers = ['Timestamp', 'Level', 'Service', 'Message', 'Trace ID'];
      const rows = logsData.data.map(log => [
        new Date(log.timestamp).toISOString(),
        log.severityText,
        log.serviceName || '-',
        log.body.replace(/"/g, '""'), // Escape quotes
        log.traceId || '-',
      ]);

      const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const {
    data: logsData,
    isLoading,
    error: logsError,
    refetch,
  } = useLogsQuery(
    {
      timeRange,
      severityLevel: levelFilter ? [levelFilter as "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL"] : undefined,
      serviceName: serviceFilter || undefined,
      search: searchQuery || undefined,
      limit: 5000,
    },
    { refetchInterval: autoRefresh ? 3000 : undefined }
  );

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: logsData?.data.length || 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  const services = Array.from(new Set(logsData?.data.map(l => l.serviceName).filter(Boolean))) as string[];
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Logs</h1>
          <Badge variant="secondary" className="ml-2">
            {logsData?.total || 0} logs
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
            Live
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

    {logsError && (
      <div className="px-4 py-3 border-b bg-muted/20">
        <Alert variant="destructive">
          <AlertTitle>Failed to load logs</AlertTitle>
          <AlertDescription className="text-xs flex flex-wrap items-center gap-2">
            <span>
              {logsError instanceof Error
                ? logsError.message
                : "Unexpected error while querying ClickHouse."}
            </span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-3 w-3 mr-1" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )}

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
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2">
              <Select value={levelFilter} onValueChange={setLevelFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All levels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All levels</SelectItem>
                  <SelectItem value="DEBUG">Debug</SelectItem>
                  <SelectItem value="INFO">Info</SelectItem>
                  <SelectItem value="WARN">Warning</SelectItem>
                  <SelectItem value="ERROR">Error</SelectItem>
                  <SelectItem value="FATAL">Fatal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2">
              <Select value={serviceFilter} onValueChange={setServiceFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {services.map(service => (
                    <SelectItem key={service} value={service}>{service}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-6 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search logs by message, trace ID, or attributes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* Logs display */}
      <div className="flex-1 flex overflow-hidden">
        {/* Logs list */}
        <div className={`flex-1 flex flex-col ${selectedLog ? "border-r" : ""}`}>
          {/* Table header */}
          <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-4 text-xs font-medium text-muted-foreground">
            <div className="w-24">Time</div>
            <div className="w-16">Level</div>
            <div className="w-32">Service</div>
            <div className="flex-1">Message</div>
            <div className="w-20">Trace</div>
          </div>

          {/* Virtual scrolling logs */}
          <div ref={parentRef} className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                Loading logs...
              </div>
            ) : logsData?.data.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                No logs found
              </div>
            ) : (
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const log = logsData!.data[virtualRow.index];
                  return (
                    <div
                      key={virtualRow.index}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <LogRow
                        log={log}
                        isSelected={selectedLog?.timestamp === log.timestamp}
                        onClick={() => setSelectedLog(log)}
                        onTraceClick={(traceId) => router.push(`/observability/traces?traceId=${traceId}`)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Log details panel */}
        {selectedLog && (
          <div className="w-[500px] flex flex-col bg-muted/20">
            <div className="px-4 py-3 border-b bg-background flex items-center justify-between">
              <h3 className="text-sm font-semibold">Log Details</h3>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setSelectedLog(null)}
              >
                ✕
              </Button>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-4 text-xs">
              <div>
                <div className="text-muted-foreground mb-1">Timestamp</div>
                <div className="font-mono">{new Date(selectedLog.timestamp).toISOString()}</div>
              </div>

              <div>
                <div className="text-muted-foreground mb-1">Level</div>
                <Badge className={`${LEVEL_COLORS[selectedLog.severityText]} text-white`}>
                  {selectedLog.severityText}
                </Badge>
              </div>

              {selectedLog.serviceName && (
                <div>
                  <div className="text-muted-foreground mb-1">Service</div>
                  <div>{selectedLog.serviceName}</div>
                </div>
              )}

              <div>
                <div className="text-muted-foreground mb-1">Message</div>
                <div className="p-2 bg-muted rounded font-mono text-[11px] break-all">
                  {selectedLog.body}
                </div>
              </div>

              {selectedLog.traceId && (
                <div>
                  <div className="text-muted-foreground mb-1">Trace ID</div>
                  <div className="flex items-center gap-2">
                    <code
                      className="flex-1 text-[11px] p-1 bg-muted rounded cursor-pointer hover:bg-muted/70 transition-colors"
                      onClick={() => router.push(`/observability/traces?traceId=${selectedLog.traceId}`)}
                      title="Click to view trace"
                    >
                      {selectedLog.traceId}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => router.push(`/observability/traces?traceId=${selectedLog.traceId}`)}
                      title="View trace details"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}

              {selectedLog.attributes && Object.keys(selectedLog.attributes).length > 0 && (
                <div>
                  <div className="text-muted-foreground mb-2">Attributes</div>
                  <div className="space-y-1">
                    {Object.entries(selectedLog.attributes).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <div className="text-muted-foreground min-w-32">{key}:</div>
                        <div className="font-mono flex-1 break-all">{String(value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LogRow({ log, isSelected, onClick, onTraceClick }: {
  log: Log;
  isSelected: boolean;
  onClick: () => void;
  onTraceClick: (traceId: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(log.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [log.body]);

  const handleTraceClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (log.traceId) {
      onTraceClick(log.traceId);
    }
  }, [log.traceId, onTraceClick]);

  return (
    <div
      className={`px-4 py-1.5 flex items-center gap-4 text-xs cursor-pointer hover:bg-accent/30 border-b border-border/50 ${
        isSelected ? "bg-accent" : ""
      }`}
      onClick={onClick}
    >
      <div className="w-24 text-muted-foreground font-mono text-[11px]">
        {new Date(log.timestamp).toLocaleTimeString()}
      </div>

      <div className="w-16">
        <Badge className={`${LEVEL_COLORS[log.severityText]} text-white h-5 text-[10px]`}>
          {log.severityText.slice(0, 4)}
        </Badge>
      </div>

      <div className="w-32 truncate text-muted-foreground">
        {log.serviceName || "-"}
      </div>

      <div className="flex-1 font-mono text-[11px] truncate group">
        {log.body}
        <Button
          variant="ghost"
          size="sm"
          className="h-4 w-4 p-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>

      <div
        className={`w-20 font-mono text-[10px] truncate ${
          log.traceId ? "text-blue-600 hover:text-blue-800 cursor-pointer underline decoration-dotted" : "text-muted-foreground"
        }`}
        onClick={log.traceId ? handleTraceClick : undefined}
        title={log.traceId ? "Click to view trace" : undefined}
      >
        {log.traceId ? log.traceId.slice(0, 8) : "-"}
      </div>
    </div>
  );
}
