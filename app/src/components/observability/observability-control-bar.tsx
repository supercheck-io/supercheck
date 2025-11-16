/**
 * ObservabilityControlBar
 * Reusable bottom control bar for observability pages (Traces, Logs, Services)
 * Provides consistent UI/UX for filters, refresh, and export actions
 */

"use client";

import React from "react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Filter, RefreshCw, Download } from "lucide-react";
import { cn } from "~/lib/utils";

interface ObservabilityControlBarProps {
  /** Total count of items displayed */
  itemCount: number;
  /** Label for the items (e.g., "traces", "logs", "services") */
  itemLabel: string;
  /** Whether filters are currently shown */
  showFilters: boolean;
  /** Callback when filter toggle is clicked */
  onToggleFilters: () => void;
  /** Callback when refresh is clicked */
  onRefresh: () => void;
  /** Whether auto-refresh is enabled */
  autoRefresh: boolean;
  /** Callback when auto-refresh toggle is clicked */
  onToggleAutoRefresh: () => void;
  /** Export options - if provided, shows export dropdown */
  onExport?: (format: "json" | "csv") => void;
  /** Additional className */
  className?: string;
  /** Show/hide filter toggle button */
  showFilterToggle?: boolean;
  /** Show/hide refresh button */
  showRefreshButton?: boolean;
  /** Show/hide export dropdown */
  showExportButton?: boolean;
  /** Additional content to render on the right side */
  rightContent?: React.ReactNode;
}

export function ObservabilityControlBar({
  itemCount,
  itemLabel,
  showFilters,
  onToggleFilters,
  onRefresh,
  autoRefresh,
  onToggleAutoRefresh,
  onExport,
  className,
  showFilterToggle = true,
  showRefreshButton = true,
  showExportButton = true,
  rightContent,
}: ObservabilityControlBarProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-6 py-3",
        "border-t bg-muted/30",
        "space-x-4",
        className
      )}
    >
      {/* Left side: Item count badge */}
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-xs">
          {itemCount} {itemLabel}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {autoRefresh && "• Auto-refreshing"}
        </span>
      </div>

      {/* Right side: Action buttons */}
      <div className="flex items-center gap-1.5 ml-auto">
        {rightContent}

        {showFilterToggle && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={onToggleFilters}
            title={showFilters ? "Hide filters" : "Show filters"}
          >
            <Filter className="h-3.5 w-3.5 mr-1.5" />
            {showFilters ? "Hide" : "Show"} Filters
          </Button>
        )}

        {showRefreshButton && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={onRefresh}
            title="Refresh data"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        )}

        <Button
          variant={autoRefresh ? "default" : "ghost"}
          size="sm"
          className="h-7 text-xs"
          onClick={onToggleAutoRefresh}
          title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh"}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${autoRefresh ? "animate-spin" : ""}`}
          />
        </Button>

        {showExportButton && onExport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                title="Export data"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
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
