"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe, TrendingUp, TrendingDown, Activity, Clock } from "lucide-react";
import {
  getLocationMetadata,
  getLocationHealthColor,
} from "@/lib/location-service";
import type { MonitoringLocation } from "@/lib/location-service";

interface LocationStat {
  location: MonitoringLocation;
  totalChecks: number;
  upChecks: number;
  uptimePercentage: number;
  avgResponseTime: number | null;
  minResponseTime: number | null;
  maxResponseTime: number | null;
  latest: {
    checkedAt: string | null;
    status: string;
    isUp: boolean;
    responseTimeMs: number | null;
  } | null;
}

type LocationStatsResponse = {
  success: boolean;
  data: LocationStat[];
};

interface LocationStatusGridProps {
  monitorId: string;
  days?: number;
}

export function LocationStatusGrid({
  monitorId,
  days = 7,
}: LocationStatusGridProps) {
  const [stats, setStats] = useState<LocationStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLocationStats = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `/api/monitors/${monitorId}/location-stats?days=${days}`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch location statistics");
        }

        const data: LocationStatsResponse = await response.json();
        setStats(data.data || []);
      } catch (err) {
        console.error("Error fetching location stats:", err);
        setError(err instanceof Error ? err.message : "Failed to load statistics");
      } finally {
        setLoading(false);
      }
    };

    fetchLocationStats();
  }, [monitorId, days]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Location Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Location Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (stats.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Location Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            No location data available. The monitor may not have run yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Location Status
          </CardTitle>
          <Badge variant="outline">{stats.length} Location{stats.length !== 1 ? "s" : ""}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stats.map((stat) => {
            const metadata = getLocationMetadata(stat.location);
            const healthColor = getLocationHealthColor(stat.uptimePercentage);
            const isUp = stat.latest?.isUp || false;

            return (
              <div
                key={stat.location}
                className={`rounded-lg border p-4 space-y-3 transition-all ${
                  isUp
                    ? "border-green-200 bg-green-50 dark:bg-green-950/20"
                    : "border-red-200 bg-red-50 dark:bg-red-950/20"
                }`}
              >
                {/* Location Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {metadata?.flag && (
                      <span className="text-xl">{metadata.flag}</span>
                    )}
                    <div>
                      <h3 className="font-semibold text-sm">
                        {metadata?.name || stat.location}
                      </h3>
                      <p className="text-xs text-gray-500">
                        {metadata?.region || ""}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={isUp ? "default" : "destructive"}
                    className="text-xs"
                  >
                    {isUp ? "UP" : "DOWN"}
                  </Badge>
                </div>

                {/* Uptime Percentage */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">Uptime (last {days}d)</span>
                    <span className={`font-bold ${healthColor}`}>
                      {stat.uptimePercentage.toFixed(2)}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        stat.uptimePercentage >= 99
                          ? "bg-green-600"
                          : stat.uptimePercentage >= 95
                          ? "bg-yellow-600"
                          : "bg-red-600"
                      }`}
                      style={{ width: `${stat.uptimePercentage}%` }}
                    />
                  </div>
                </div>

                {/* Response Time */}
                {stat.avgResponseTime !== null && (
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1 text-gray-600">
                      <Activity className="h-3 w-3" />
                      <span>Avg Response</span>
                    </div>
                    <span className="font-medium">
                      {Math.round(stat.avgResponseTime)}ms
                    </span>
                  </div>
                )}

                {/* Min/Max Response Time */}
                {stat.minResponseTime !== null && stat.maxResponseTime !== null && (
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-1">
                      <TrendingDown className="h-3 w-3 text-green-600" />
                      <span>{Math.round(stat.minResponseTime)}ms</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3 text-orange-600" />
                      <span>{Math.round(stat.maxResponseTime)}ms</span>
                    </div>
                  </div>
                )}

                {/* Last Check */}
                {stat.latest && (
                  <div className="flex items-center gap-1 text-xs text-gray-500 border-t pt-2">
                    <Clock className="h-3 w-3" />
                    <span>
                      Last check:{" "}
                      {stat.latest.responseTimeMs !== null
                        ? `${stat.latest.responseTimeMs}ms`
                        : "N/A"}
                    </span>
                  </div>
                )}

                {/* Check Count */}
                <div className="text-xs text-gray-500 pt-1">
                  {stat.upChecks}/{stat.totalChecks} checks passed
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
