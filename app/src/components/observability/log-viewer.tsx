"use client";

import { useState, useMemo } from "react";
import { Card } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  FileText,
  Search,
  AlertCircle,
  Info,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Log } from "~/types/observability";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

interface LogViewerProps {
  logs: Log[];
  showHeader?: boolean;
  showFilters?: boolean;
  className?: string;
  maxHeight?: string;
}

export function LogViewer({
  logs,
  showHeader = true,
  showFilters = true,
  className = "",
  maxHeight = "500px",
}: LogViewerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());

  const filteredLogs = useMemo(() => {
    const searchValue = searchQuery.toLowerCase();
    return logs.filter((log) => {
      const message = getLogMessage(log);
      const level = getLogLevel(log);
      const serviceName = (log.serviceName || "").toLowerCase();

      const matchesSearch =
        !searchValue ||
        message.toLowerCase().includes(searchValue) ||
        serviceName.includes(searchValue);

      const matchesLevel =
        levelFilter === "all" || level.toLowerCase() === levelFilter;

      return matchesSearch && matchesLevel;
    });
  }, [logs, searchQuery, levelFilter]);

  const logLevels = useMemo(() => {
    const levels = [...new Set(logs.map((log) => getLogLevel(log)))];
    return levels.sort();
  }, [logs]);

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    logs.forEach((log) => {
      const level = getLogLevel(log).toLowerCase();
      counts[level] = (counts[level] || 0) + 1;
    });
    return counts;
  }, [logs]);

  const toggleExpand = (index: number) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  if (logs.length === 0) {
    return (
      <Card className={`${className} border-dashed border-border/60 bg-muted/20`}>
        <div className="p-10 text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-amber-500/10 rounded-lg">
              <FileText className="h-6 w-6 text-amber-500" />
            </div>
          </div>
          <p className="font-medium text-sm mb-1">No logs captured</p>
          <p className="text-xs text-muted-foreground">Execution logs will appear here when available</p>
        </div>
      </Card>
    );
  }

  return (
    <div className={className}>
      {showHeader && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold">Logs</h3>
              <p className="text-xs text-muted-foreground">
                {filteredLogs.length} of {logs.length} logs
                {Object.entries(levelCounts).map(([level, count]) => (
                  <span key={level} className="ml-2">
                    • <span className="capitalize">{level}</span>: {count}
                  </span>
                ))}
              </p>
            </div>
          </div>
        </div>
      )}

      {showFilters && (
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="w-40 h-9">
              <SelectValue placeholder="All levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              {logLevels.map((level) => (
                <SelectItem key={level} value={level.toLowerCase()}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Card className="border-border/50">
        <div
          className="overflow-auto"
          style={{ maxHeight }}
        >
          <div className="divide-y divide-border/50">
            {filteredLogs.map((log, index) => (
              <LogEntry
                key={index}
                log={log}
                isExpanded={expandedLogs.has(index)}
                onToggleExpand={() => toggleExpand(index)}
              />
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

function LogEntry({
  log,
  isExpanded,
  onToggleExpand,
}: {
  log: Log;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const level = getLogLevel(log);
  const levelConfig = getLevelConfig(level);
  const attributes = getLogAttributes(log);
  const resource = getLogResource(log);
  const hasAttributes = Object.keys(attributes).length > 0;
  const hasResource = Object.keys(resource).length > 0;

  return (
    <div className="hover:bg-accent/20 transition-colors">
      <div
        className="flex items-start gap-3 p-3 cursor-pointer"
        onClick={onToggleExpand}
      >
        {/* Expand/collapse icon */}
        <div className="mt-0.5 flex-shrink-0">
          {hasAttributes || hasResource ? (
            isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )
          ) : (
            <div className="w-4" />
          )}
        </div>

        {/* Timestamp */}
        <div className="w-32 flex-shrink-0 text-[10px] font-mono text-muted-foreground mt-0.5">
          {new Date(log.timestamp).toLocaleTimeString(undefined, {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            fractionalSecondDigits: 3,
          })}
        </div>

        {/* Level badge */}
        <div className="flex-shrink-0">
          <Badge
            variant={levelConfig.variant}
            className={`h-5 text-[10px] ${levelConfig.className}`}
          >
            <levelConfig.icon className="h-3 w-3 mr-1" />
            {level.toUpperCase()}
          </Badge>
        </div>

        {/* Message */}
        <div className="flex-1 min-w-0">
          <div className="text-sm break-words">{getLogMessage(log)}</div>
          {log.serviceName && (
            <div className="text-[10px] text-muted-foreground mt-1">
              {log.serviceName}
            </div>
          )}
        </div>

        {/* Trace link */}
        {log.traceId && (
          <div className="flex-shrink-0">
            <Badge variant="outline" className="text-[10px] font-mono">
              trace
            </Badge>
          </div>
        )}
      </div>

      {/* Expanded details */}
      {isExpanded && (hasAttributes || hasResource) && (
        <div className="px-3 pb-3 ml-7 space-y-3 text-xs">
          {hasAttributes && (
            <div>
              <div className="font-medium text-muted-foreground mb-1">
                Attributes
              </div>
              <div className="bg-muted/30 rounded p-2 space-y-1">
                {Object.entries(attributes).map(([key, value]) => (
                  <div key={key} className="flex gap-2 font-mono text-[10px]">
                    <span className="text-muted-foreground min-w-32">
                      {key}:
                    </span>
                    <span className="break-all">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasResource && (
            <div>
              <div className="font-medium text-muted-foreground mb-1">
                Resource
              </div>
              <div className="bg-muted/30 rounded p-2 space-y-1">
                {Object.entries(resource).map(([key, value]) => (
                  <div key={key} className="flex gap-2 font-mono text-[10px]">
                    <span className="text-muted-foreground min-w-32">
                      {key}:
                    </span>
                    <span className="break-all">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {log.traceId && (
            <div>
              <div className="font-medium text-muted-foreground mb-1">
                Trace Context
              </div>
              <div className="bg-muted/30 rounded p-2 space-y-1 font-mono text-[10px]">
                <div className="flex gap-2">
                  <span className="text-muted-foreground min-w-24">
                    Trace ID:
                  </span>
                  <span className="break-all">{log.traceId}</span>
                </div>
                {log.spanId && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground min-w-24">
                      Span ID:
                    </span>
                    <span className="break-all">{log.spanId}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getLevelConfig(
  level: string
): { variant: BadgeVariant; className: string; icon: LucideIcon } {
  const levelLower = level.toLowerCase();

  switch (levelLower) {
    case "error":
    case "fatal":
      return {
        variant: "destructive",
        className: "",
        icon: XCircle,
      };
    case "warn":
    case "warning":
      return {
        variant: "default",
        className: "bg-yellow-500 text-white hover:bg-yellow-600",
        icon: AlertTriangle,
      };
    case "info":
      return {
        variant: "default",
        className: "bg-blue-500 text-white hover:bg-blue-600",
        icon: Info,
      };
    case "debug":
      return {
        variant: "outline",
        className: "",
        icon: AlertCircle,
      };
    default:
      return {
        variant: "secondary",
        className: "",
        icon: FileText,
      };
  }
}

function getLogLevel(log: Log) {
  return (log.level || log.severityText || "info").toString();
}

function getLogMessage(log: Log) {
  return log.message || log.body || "";
}

function getLogAttributes(log: Log) {
  return log.attributes || {};
}

function getLogResource(log: Log) {
  return log.resource || log.resourceAttributes || {};
}
