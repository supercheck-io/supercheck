/**
 * Service Map Page
 * Displays service topology and dependencies
 */

"use client";

import { useState, useMemo, useCallback } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useServiceMap } from "~/hooks/useObservability";
import { ServiceMapSkeleton } from "~/components/observability/loading-skeleton";
import { ServiceMapCytoscape } from "~/components/observability/service-map-cytoscape";
import { Activity, RefreshCw } from "lucide-react";
import type { TimeRange } from "~/types/observability";

export default function ServiceMapPage() {
  const [timeRangePreset, setTimeRangePreset] = useState("1h");

  const timeRange: TimeRange = useMemo(() => {
    const end = new Date();
    const start = new Date();

    switch (timeRangePreset) {
      case "15m":
        start.setMinutes(start.getMinutes() - 15);
        break;
      case "1h":
        start.setHours(start.getHours() - 1);
        break;
      case "6h":
        start.setHours(start.getHours() - 6);
        break;
      case "24h":
        start.setHours(start.getHours() - 24);
        break;
      default:
        start.setHours(start.getHours() - 1);
    }

    return {
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }, [timeRangePreset]);

  const { data: serviceMap, isLoading, refetch } = useServiceMap(timeRange, {
    refetchInterval: 60000, // Refresh every minute
  });

  const handleServiceClick = useCallback((serviceName: string) => {
    // Can be used to navigate to service details or filter
    console.log("Clicked service:", serviceName);
  }, []);

  if (isLoading) {
    return <ServiceMapSkeleton />;
  }

  const nodes = serviceMap?.nodes ?? [];
  const edges = serviceMap?.edges ?? [];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Unified Filters Bar - consistent with Traces and Logs */}
      <div className="border-b bg-muted/30">
        <div className="flex items-center gap-2 flex-wrap px-4 py-3">
          {/* Count badge */}
          <Badge variant="secondary" className="text-xs font-medium whitespace-nowrap">
            {nodes.length} services
          </Badge>

          {/* Time range */}
          <Select value={timeRangePreset} onValueChange={setTimeRangePreset}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15m">Last 15m</SelectItem>
              <SelectItem value="1h">Last 1h</SelectItem>
              <SelectItem value="6h">Last 6h</SelectItem>
              <SelectItem value="24h">Last 24h</SelectItem>
            </SelectContent>
          </Select>

          {/* Refresh button - right aligned */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 ml-auto"
            onClick={() => refetch()}
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Main content area - Interactive Cytoscape Service Map */}
      {nodes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center bg-white">
          <Card className="w-96">
            <CardContent className="flex flex-col items-center justify-center pt-8">
              <Activity className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-center">
                No services found in the selected time range
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <ServiceMapCytoscape
          nodes={nodes}
          edges={edges}
          onServiceClick={handleServiceClick}
        />
      )}
    </div>
  );
}
