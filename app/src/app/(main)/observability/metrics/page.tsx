"use client";

import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  BarChart3,
  Filter,
  RefreshCw,
  Download,
  Zap,
  Activity
} from "lucide-react";
import Link from "next/link";

export default function MetricsPage() {
  const [timePreset, setTimePreset] = useState("last_1h");
  const [runTypeFilter, setRunTypeFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Metrics</h1>
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
              <Button variant="outline" size="sm" disabled>
                <Download className="h-4 w-4 mr-1" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled>
                Export as JSON
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
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
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 mb-6">
            <BarChart3 className="h-8 w-8 text-blue-600" />
          </div>

          <h2 className="text-2xl font-semibold text-foreground mb-2">No Metrics Data Available</h2>

          <p className="text-muted-foreground mb-6">
            Metrics will appear here once your services start processing requests. Make sure you have:
          </p>

          <ul className="space-y-2 text-sm text-muted-foreground text-left mb-8">
            <li className="flex items-start gap-3">
              <Zap className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <span>Tests or monitors running to generate telemetry data</span>
            </li>
            <li className="flex items-start gap-3">
              <Activity className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <span>Services with observability instrumentation enabled</span>
            </li>
            <li className="flex items-start gap-3">
              <Zap className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <span>ClickHouse backend configured and running</span>
            </li>
          </ul>

          <div className="flex gap-3 justify-center">
            <Button asChild>
              <Link href="/tests">Create a Test</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/monitors">View Monitors</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
