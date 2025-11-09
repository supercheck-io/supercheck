"use client";

import { useMemo } from "react";
import { Card } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { TrendingUp, TrendingDown, Activity, BarChart3 } from "lucide-react";
import type { MetricSeries } from "~/types/observability";

interface MetricsChartProps {
  metrics: MetricSeries[];
  title?: string;
  description?: string;
  unit?: string;
  showTrend?: boolean;
  className?: string;
  height?: number;
}

export function MetricsChart({
  metrics,
  title,
  description,
  unit = "",
  showTrend = true,
  className = "",
  height = 200,
}: MetricsChartProps) {
  const chartData = useMemo(() => {
    if (metrics.length === 0 || metrics[0].points.length === 0) {
      return {
        minValue: 0,
        maxValue: 100,
        values: [],
        timestamps: [],
      };
    }

    const allPoints = metrics.flatMap((m) => m.points);
    const values = allPoints.map((p) => p.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);

    return {
      minValue,
      maxValue,
      values,
      timestamps: allPoints.map((p) => p.timestamp),
    };
  }, [metrics]);

  const trend = useMemo(() => {
    if (metrics.length === 0 || metrics[0].points.length < 2) {
      return { direction: "neutral" as const, percentage: 0 };
    }

    const points = metrics[0].points;
    const first = points[0].value;
    const last = points[points.length - 1].value;
    const change = ((last - first) / first) * 100;

    return {
      direction: change > 0 ? ("up" as const) : change < 0 ? ("down" as const) : ("neutral" as const),
      percentage: Math.abs(change),
    };
  }, [metrics]);

  const latestValue = useMemo(() => {
    if (metrics.length === 0 || metrics[0].points.length === 0) {
      return null;
    }
    return metrics[0].points[metrics[0].points.length - 1].value;
  }, [metrics]);

  if (metrics.length === 0) {
    return (
      <Card className={className}>
        <div className="p-8 text-center">
          <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No metrics data available</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={`${className} p-4`}>
      {/* Header */}
      {(title || description) && (
        <div className="mb-4">
          <div className="flex items-start justify-between">
            <div>
              {title && <h3 className="text-sm font-semibold mb-1">{title}</h3>}
              {description && (
                <p className="text-xs text-muted-foreground">{description}</p>
              )}
            </div>
            {showTrend && latestValue !== null && (
              <div className="text-right">
                <div className="text-2xl font-bold">
                  {formatValue(latestValue, unit)}
                </div>
                {trend.direction !== "neutral" && (
                  <div
                    className={`flex items-center gap-1 text-xs ${
                      trend.direction === "up"
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {trend.direction === "up" ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {trend.percentage.toFixed(1)}%
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Simple line chart */}
      <div className="relative" style={{ height: `${height}px` }}>
        <svg
          width="100%"
          height="100%"
          className="overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {metrics.map((metric, seriesIndex) => {
            const points = metric.points;
            if (points.length === 0) return null;

            // Generate path
            const pathPoints = points.map((point, index) => {
              const x = (index / (points.length - 1 || 1)) * 100;
              const y =
                100 -
                ((point.value - chartData.minValue) /
                  (chartData.maxValue - chartData.minValue || 1)) *
                  100;
              return { x, y };
            });

            const pathData = pathPoints
              .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
              .join(" ");

            const areaData = `${pathData} L 100 100 L 0 100 Z`;

            const colors = [
              "stroke-blue-500 fill-blue-500/10",
              "stroke-purple-500 fill-purple-500/10",
              "stroke-green-500 fill-green-500/10",
              "stroke-orange-500 fill-orange-500/10",
            ];
            const color = colors[seriesIndex % colors.length];

            return (
              <g key={seriesIndex}>
                {/* Area */}
                <path
                  d={areaData}
                  className={color.split(" ")[1]}
                  vectorEffect="non-scaling-stroke"
                />
                {/* Line */}
                <path
                  d={pathData}
                  className={color.split(" ")[0]}
                  strokeWidth="2"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>

        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between text-[10px] text-muted-foreground -ml-12 w-10 text-right">
          <span>{formatValue(chartData.maxValue, unit)}</span>
          <span>
            {formatValue((chartData.maxValue + chartData.minValue) / 2, unit)}
          </span>
          <span>{formatValue(chartData.minValue, unit)}</span>
        </div>
      </div>

      {/* Legend */}
      {metrics.length > 1 && (
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
          {metrics.map((metric, index) => {
            const colors = [
              "bg-blue-500",
              "bg-purple-500",
              "bg-green-500",
              "bg-orange-500",
            ];
            return (
              <Badge key={index} variant="outline" className="text-[10px]">
                <div
                  className={`w-2 h-2 rounded-full ${
                    colors[index % colors.length]
                  } mr-1.5`}
                />
                {metric.name}
              </Badge>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function formatValue(value: number, unit: string): string {
  if (unit === "ms" || unit === "milliseconds") {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(2)}s`;
    }
    return `${value.toFixed(0)}ms`;
  }

  if (unit === "bytes") {
    if (value >= 1024 * 1024 * 1024) {
      return `${(value / (1024 * 1024 * 1024)).toFixed(2)}GB`;
    }
    if (value >= 1024 * 1024) {
      return `${(value / (1024 * 1024)).toFixed(2)}MB`;
    }
    if (value >= 1024) {
      return `${(value / 1024).toFixed(2)}KB`;
    }
    return `${value.toFixed(0)}B`;
  }

  if (unit === "%") {
    return `${value.toFixed(1)}%`;
  }

  // Default formatting
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(2)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}K`;
  }

  return value.toFixed(2) + (unit ? ` ${unit}` : "");
}

interface StatsCardProps {
  label: string;
  value: string | number;
  trend?: {
    direction: "up" | "down" | "neutral";
    value: string | number;
  };
  icon?: React.ReactNode;
  className?: string;
}

export function StatsCard({
  label,
  value,
  trend,
  icon,
  className = "",
}: StatsCardProps) {
  return (
    <Card className={`p-4 ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="text-xs font-medium text-muted-foreground mb-1">
            {label}
          </div>
          <div className="text-2xl font-bold">{value}</div>
          {trend && (
            <div
              className={`flex items-center gap-1 text-xs mt-1 ${
                trend.direction === "up"
                  ? "text-green-600"
                  : trend.direction === "down"
                  ? "text-red-600"
                  : "text-muted-foreground"
              }`}
            >
              {trend.direction === "up" && <TrendingUp className="h-3 w-3" />}
              {trend.direction === "down" && <TrendingDown className="h-3 w-3" />}
              {trend.direction === "neutral" && <Activity className="h-3 w-3" />}
              {trend.value}
            </div>
          )}
        </div>
        {icon && <div className="text-muted-foreground/50">{icon}</div>}
      </div>
    </Card>
  );
}
