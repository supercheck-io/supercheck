"use client";

import { useState } from "react";
import { useLogsQuery } from "~/hooks/useObservability";
import { getTimeRangePreset } from "~/lib/observability";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Search } from "lucide-react";
import type { Log } from "~/types/observability";

const LEVEL_COLORS: Record<string, string> = {
  TRACE: "bg-gray-500",
  DEBUG: "bg-blue-500",
  INFO: "bg-green-500",
  WARN: "bg-yellow-500",
  ERROR: "bg-red-500",
  FATAL: "bg-purple-500",
};

export default function LogsPage() {
  const [timePreset, setTimePreset] = useState("last_1h");
  const [levelFilter, setLevelFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const timeRange = getTimeRangePreset(timePreset);

  const { data: logsData, isLoading } = useLogsQuery({
    timeRange,
    severityLevel: levelFilter ? [levelFilter as "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL"] : undefined,
    search: searchQuery || undefined,
    limit: 1000,
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Logs</h1>
        <p className="text-muted-foreground">Application logs from your tests and services</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Level</label>
              <Select value={levelFilter} onValueChange={setLevelFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All levels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All levels</SelectItem>
                  <SelectItem value="DEBUG">Debug</SelectItem>
                  <SelectItem value="INFO">Info</SelectItem>
                  <SelectItem value="WARN">Warning</SelectItem>
                  <SelectItem value="ERROR">Error</SelectItem>
                  <SelectItem value="FATAL">Fatal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Logs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Logs ({logsData?.total || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading logs...</div>
          ) : logsData?.data.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No logs found</div>
          ) : (
            <div className="space-y-1">
              {logsData?.data.map((log, idx) => (
                <LogEntry key={`${log.timestamp}-${idx}`} log={log} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LogEntry({ log }: { log: Log }) {
  return (
    <div className="border-b last:border-0 py-2 hover:bg-accent/50 px-2 rounded">
      <div className="flex items-start gap-3">
        <Badge className={`${LEVEL_COLORS[log.severityText]} text-white text-xs shrink-0`}>
          {log.severityText}
        </Badge>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-mono break-all">{log.body}</div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
            <span>{new Date(log.timestamp).toLocaleString()}</span>
            {log.serviceName && <span className="font-medium">{log.serviceName}</span>}
            {log.traceId && (
              <span className="font-mono hover:underline cursor-pointer" title="View trace">
                {log.traceId.slice(0, 8)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
