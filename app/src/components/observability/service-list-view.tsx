/**
 * Service List View
 * Displays services in a table format with filtering and sorting
 */

"use client";

import React, { useMemo, useState } from "react";
import { ChevronDown, AlertCircle, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";
import type { ServiceNode } from "~/types/observability";

interface ServiceListViewProps {
  services: ServiceNode[];
  onServiceSelect?: (serviceName: string) => void;
  selectedService?: string | null;
}

type SortBy = "name" | "requests" | "errors" | "latency" | "error-rate";
type FilterHealth = "all" | "healthy" | "warning" | "critical";

export function ServiceListView({
  services,
  onServiceSelect,
  selectedService,
}: ServiceListViewProps) {
  const [sortBy, setSortBy] = useState<SortBy>("requests");
  const [filterHealth, setFilterHealth] = useState<FilterHealth>("all");

  const filteredAndSorted = useMemo(() => {
    let filtered = services.filter((s) => {
      if (filterHealth === "all") return true;
      if (filterHealth === "healthy") return s.errorRate < 1;
      if (filterHealth === "warning") return s.errorRate >= 1 && s.errorRate < 10;
      if (filterHealth === "critical") return s.errorRate >= 10;
      return true;
    });

    return filtered.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.serviceName.localeCompare(b.serviceName);
        case "requests":
          return b.requestCount - a.requestCount;
        case "errors":
          return (b.errorRate / 100) * b.requestCount - (a.errorRate / 100) * a.requestCount;
        case "latency":
          return b.avgLatency - a.avgLatency;
        case "error-rate":
          return b.errorRate - a.errorRate;
        default:
          return 0;
      }
    });
  }, [services, sortBy, filterHealth]);

  const getHealthIcon = (errorRate: number) => {
    if (errorRate >= 10)
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    if (errorRate >= 1)
      return <AlertCircle className="h-4 w-4 text-amber-500" />;
    return <CheckCircle className="h-4 w-4 text-green-500" />;
  };

  const getHealthBadgeColor = (errorRate: number) => {
    if (errorRate >= 10) return "bg-red-500/20 text-red-700 dark:text-red-400";
    if (errorRate >= 1) return "bg-amber-500/20 text-amber-700 dark:text-amber-400";
    return "bg-green-500/20 text-green-700 dark:text-green-400";
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="flex-1 min-w-max">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-2">
            Sort By
          </label>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="requests">Most Requests</SelectItem>
              <SelectItem value="errors">Most Errors</SelectItem>
              <SelectItem value="latency">Highest Latency</SelectItem>
              <SelectItem value="error-rate">Highest Error Rate</SelectItem>
              <SelectItem value="name">Service Name</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 min-w-max">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-2">
            Health
          </label>
          <Select
            value={filterHealth}
            onValueChange={(v) => setFilterHealth(v as FilterHealth)}
          >
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Services</SelectItem>
              <SelectItem value="healthy">Healthy</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Services Table */}
      <div className="border rounded-lg overflow-hidden">
        {/* Header */}
        <div className="bg-muted/50 border-b grid grid-cols-12 gap-4 px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <div className="col-span-3">Service</div>
          <div className="col-span-2 text-right">Requests</div>
          <div className="col-span-2 text-right">Errors</div>
          <div className="col-span-2 text-right">Latency</div>
          <div className="col-span-2 text-right">Error Rate</div>
          <div className="col-span-1"></div>
        </div>

        {/* Rows */}
        <div className="divide-y">
          {filteredAndSorted.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No services found matching the selected filters
            </div>
          ) : (
            filteredAndSorted.map((service) => (
              <div
                key={service.serviceName}
                className={cn(
                  "grid grid-cols-12 gap-4 px-4 py-3 items-center hover:bg-muted/50 transition-colors cursor-pointer border-l-4",
                  selectedService === service.serviceName
                    ? "border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
                    : "border-l-transparent"
                )}
                onClick={() => onServiceSelect?.(service.serviceName)}
              >
                {/* Service Name */}
                <div className="col-span-3 flex items-center gap-2 min-w-0">
                  {getHealthIcon(service.errorRate)}
                  <span className="font-medium text-sm truncate">
                    {service.serviceName}
                  </span>
                </div>

                {/* Requests */}
                <div className="col-span-2 text-right">
                  <span className="text-sm font-medium">
                    {service.requestCount.toLocaleString()}
                  </span>
                </div>

                {/* Errors */}
                <div className="col-span-2 text-right">
                  <span className="text-sm font-medium text-red-600 dark:text-red-400">
                    {Math.round(
                      (service.errorRate / 100) * service.requestCount
                    ).toLocaleString()}
                  </span>
                </div>

                {/* Latency */}
                <div className="col-span-2 text-right">
                  <span className="text-sm font-medium">
                    {service.avgLatency.toFixed(0)}ms
                  </span>
                </div>

                {/* Error Rate */}
                <div className="col-span-2 text-right">
                  <Badge className={cn("font-semibold text-xs", getHealthBadgeColor(service.errorRate))}>
                    {service.errorRate.toFixed(1)}%
                  </Badge>
                </div>

                {/* Chevron */}
                <div className="col-span-1 flex justify-end">
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      selectedService === service.serviceName
                        ? "transform rotate-180"
                        : ""
                    )}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-3 text-xs">
        <Card>
          <CardContent className="pt-4">
            <div className="text-muted-foreground mb-1">Total Services</div>
            <div className="text-2xl font-bold">{services.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-muted-foreground mb-1">Healthy</div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {services.filter((s) => s.errorRate < 1).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-muted-foreground mb-1">Warnings</div>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {services.filter((s) => s.errorRate >= 1 && s.errorRate < 10)
                .length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-muted-foreground mb-1">Critical</div>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {services.filter((s) => s.errorRate >= 10).length}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
