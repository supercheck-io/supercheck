/**
 * ObservabilityTopBar
 * Unified top control bar for observability pages
 * Combines count badge, filters, time range, and actions in a single polished bar
 */

"use client";

import React from "react";
import { Button } from "~/components/ui/button";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Filter, RefreshCw, Download, Search, X } from "lucide-react";
import { cn } from "~/lib/utils";

interface ObservabilityTopBarProps {
  /** Total count of items */
  itemCount: number;
  /** Label for items (e.g., "traces", "logs") */
  itemLabel: string;
  /** Whether filters are shown */
  showFilters: boolean;
  /** Callback to toggle filters */
  onToggleFilters: () => void;
  /** Callback to refresh data */
  onRefresh: () => void;
  /** Whether auto-refresh is enabled */
  autoRefresh: boolean;
  /** Callback to toggle auto-refresh */
  onToggleAutoRefresh: () => void;
  /** Export callback */
  onExport?: (format: "json" | "csv") => void;
  /** Show/hide time range selector */
  timeRangeValue?: string;
  onTimeRangeChange?: (value: string) => void;
  /** Show/hide filter toggle */
  showFilterToggle?: boolean;
  /** Show/hide export */
  showExport?: boolean;
  /** Additional right content */
  rightContent?: React.ReactNode;
}

export function ObservabilityTopBar({
  itemCount,
  itemLabel,
  showFilters,
  onToggleFilters,
  onRefresh,
  autoRefresh,
  onToggleAutoRefresh,
  onExport,
  timeRangeValue,
  onTimeRangeChange,
  showFilterToggle = true,
  showExport = true,
  rightContent,
}: ObservabilityTopBarProps) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b bg-background">
      {/* Left section: Item count and info */}
      <div className="flex items-center gap-4">
        <Badge variant="secondary" className="text-xs px-2 py-1">
          <span className="font-medium">{itemCount.toLocaleString()}</span>
          <span className="text-muted-foreground ml-1">{itemLabel}</span>
        </Badge>

        {autoRefresh && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Auto-refreshing
          </span>
        )}
      </div>

      {/* Middle section: Filters and time range */}
      <div className="flex items-center gap-2 flex-1 max-w-md mx-4">
        {showFilterToggle && (
          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={onToggleFilters}
            title={showFilters ? "Hide filters" : "Show filters"}
          >
            <Filter className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {showFilters ? "Hide" : "Show"}
            </span>
          </Button>
        )}

        {timeRangeValue !== undefined && onTimeRangeChange && (
          <Select value={timeRangeValue} onValueChange={onTimeRangeChange}>
            <SelectTrigger className="h-8 w-32 text-xs">
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
        )}
      </div>

      {/* Right section: Actions */}
      <div className="flex items-center gap-1.5">
        {rightContent}

        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onRefresh}
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>

        <Button
          variant={autoRefresh ? "secondary" : "ghost"}
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onToggleAutoRefresh}
          title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh"}
        >
          <RefreshCw
            className={`h-4 w-4 ${autoRefresh ? "animate-spin" : ""}`}
          />
        </Button>

        {showExport && onExport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                title="Export"
              >
                <Download className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem onClick={() => onExport("json")}>
                <span>Export as JSON</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("csv")}>
                <span>Export as CSV</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
