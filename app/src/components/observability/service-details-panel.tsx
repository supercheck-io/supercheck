/**
 * Service Details Panel
 * Displays detailed metrics and dependency information for a selected service
 */

"use client";

import React from "react";
import { X, AlertCircle, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { ServiceNode, ServiceEdge } from "~/types/observability";

interface ServiceDetailsPanelProps {
  service: ServiceNode | null;
  allServices: ServiceNode[];
  edges: ServiceEdge[];
  onClose: () => void;
}

export function ServiceDetailsPanel({
  service,
  allServices,
  edges,
  onClose,
}: ServiceDetailsPanelProps) {
  if (!service) return null;

  // Get incoming dependencies (services calling this one)
  const incomingDependencies = edges.filter((e) => e.target === service.serviceName);

  // Get outgoing dependencies (services this one calls)
  const outgoingDependencies = edges.filter((e) => e.source === service.serviceName);

  // Calculate golden signals metrics
  const totalRequests = service.requestCount;
  const totalErrors = Math.round((service.errorRate / 100) * totalRequests);
  const requestsPerSecond = (totalRequests / 3600).toFixed(2); // Assuming ~1h time range

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white dark:bg-slate-950 border-l border-border shadow-xl z-40 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-start justify-between">
        <div className="flex-1">
          <h2 className="text-lg font-bold truncate">{service.serviceName}</h2>
          <p className="text-xs text-muted-foreground mt-1">Service Details</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 -mr-2"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto space-y-4 px-6 py-4">
        {/* Status Section */}
        <Card className="bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 border-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Health Status</span>
              <Badge
                className={cn(
                  "font-semibold",
                  service.errorRate >= 10
                    ? "bg-red-500/20 text-red-700 dark:text-red-400"
                    : service.errorRate >= 1
                      ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                      : "bg-green-500/20 text-green-700 dark:text-green-400"
                )}
              >
                {service.errorRate >= 10
                  ? "Critical"
                  : service.errorRate >= 1
                    ? "Warning"
                    : "Healthy"}
              </Badge>
            </div>

            <div className="h-px bg-border" />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Error Rate</span>
                <span
                  className={cn(
                    "font-bold text-sm",
                    service.errorRate >= 10
                      ? "text-red-600 dark:text-red-400"
                      : service.errorRate >= 1
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-green-600 dark:text-green-400"
                  )}
                >
                  {service.errorRate.toFixed(2)}%
                </span>
              </div>

              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    service.errorRate >= 10
                      ? "bg-red-500"
                      : service.errorRate >= 1
                        ? "bg-amber-500"
                        : "bg-green-500"
                  )}
                  style={{ width: `${Math.min(service.errorRate * 3, 100)}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Golden Signals */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Golden Signals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Requests */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Total Requests
                </span>
                <span className="font-bold text-sm">{totalRequests.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Requests/sec
                </span>
                <span className="font-bold text-sm">{requestsPerSecond}</span>
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Errors */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Total Errors
                </span>
                <span className="font-bold text-sm text-red-600 dark:text-red-400">
                  {totalErrors}
                </span>
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Latency */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Average Latency
                </span>
                <span className="font-bold text-sm">{service.avgLatency.toFixed(0)}ms</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  P95 Latency
                </span>
                <span className="font-bold text-sm text-amber-600 dark:text-amber-400">
                  {service.p95Latency.toFixed(0)}ms
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Incoming Dependencies */}
        {incomingDependencies.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                Incoming Dependencies ({incomingDependencies.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {incomingDependencies.map((dep) => (
                <div
                  key={`${dep.source}-${dep.target}`}
                  className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-border hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm truncate">
                      {dep.source}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      →
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>Requests: {dep.requestCount.toLocaleString()}</div>
                    <div>Error: {dep.errorRate.toFixed(1)}%</div>
                    <div>Latency: {dep.avgLatency.toFixed(0)}ms</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Outgoing Dependencies */}
        {outgoingDependencies.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                Outgoing Dependencies ({outgoingDependencies.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {outgoingDependencies.map((dep) => (
                <div
                  key={`${dep.source}-${dep.target}`}
                  className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-border hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm truncate">
                      {dep.target}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      →
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>Requests: {dep.requestCount.toLocaleString()}</div>
                    <div>Error: {dep.errorRate.toFixed(1)}%</div>
                    <div>Latency: {dep.avgLatency.toFixed(0)}ms</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* No dependencies message */}
        {incomingDependencies.length === 0 && outgoingDependencies.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="pt-6 text-center">
              <p className="text-sm text-muted-foreground">
                No service dependencies found in this time range
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
