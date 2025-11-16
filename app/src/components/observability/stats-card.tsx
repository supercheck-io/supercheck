/**
 * Stats Card Component
 * Displays a single statistic with trend indicator
 */

"use client";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "~/lib/utils";

interface StatsCardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: number; // percentage change
  icon?: React.ReactNode;
  description?: string;
  loading?: boolean;
  className?: string;
}

export function StatsCard({
  title,
  value,
  unit,
  trend,
  icon,
  description,
  loading = false,
  className,
}: StatsCardProps) {
  const getTrendColor = (trend: number) => {
    if (trend > 0) return "text-green-600 dark:text-green-500";
    if (trend < 0) return "text-red-600 dark:text-red-500";
    return "text-gray-600 dark:text-gray-400";
  };

  const getTrendIcon = (trend: number) => {
    if (trend > 0) return <TrendingUp className="h-4 w-4" />;
    if (trend < 0) return <TrendingDown className="h-4 w-4" />;
    return <Minus className="h-4 w-4" />;
  };

  if (loading) {
    return (
      <Card className={cn(className)}>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
          {icon && <div className="h-4 w-4 bg-muted rounded animate-pulse" />}
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="h-7 w-20 bg-muted rounded animate-pulse" />
          <div className="h-3 w-16 bg-muted rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon && <div className="text-muted-foreground opacity-60">{icon}</div>}
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-bold tracking-tight">
            {typeof value === "number" ? value.toLocaleString() : value}
          </div>
          {unit && <div className="text-sm font-medium text-muted-foreground">{unit}</div>}
        </div>

        {trend !== undefined && (
          <div className="flex items-center gap-1.5 text-xs">
            <div className={cn("flex items-center gap-0.5 font-medium", getTrendColor(trend))}>
              {getTrendIcon(trend)}
              <span>{Math.abs(trend).toFixed(1)}%</span>
            </div>
            <span className="text-muted-foreground">vs previous</span>
          </div>
        )}

        {description && !trend && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}
