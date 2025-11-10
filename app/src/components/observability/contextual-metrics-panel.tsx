"use client";

import { RefreshCw, Zap } from "lucide-react";
import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { MetricsChart } from "./metrics-chart";
import { useContextualMetrics } from "@/hooks/useObservability";
import type { ContextualMetricsResponse } from "~/types/observability";

type ContextualEntity = "tests" | "jobs" | "monitors";

interface ContextualMetricsPanelProps {
  entityId: string;
  entityType: ContextualEntity;
  title?: string;
  description?: string;
  className?: string;
}

export function ContextualMetricsPanel({
  entityId,
  entityType,
  title = "Performance Insights",
  description = "Latency, error rate, and throughput trends",
  className,
}: ContextualMetricsPanelProps) {
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useContextualMetrics(entityType, entityId);

  const summaryCards = useMemo(() => {
    if (!data) return [];

    const durationFormatter = (value: number) =>
      `${Math.max(0, value).toFixed(1)} ms`;
    return [
      {
        label: "P95 Latency",
        value: durationFormatter(data.summary.p95DurationMs),
      },
      {
        label: "P99 Latency",
        value: durationFormatter(data.summary.p99DurationMs),
      },
      {
        label: "Success Rate",
        value: `${(data.summary.successRate * 100).toFixed(1)}%`,
      },
      {
        label: "Error Rate",
        value: `${(data.summary.errorRate * 100).toFixed(2)}%`,
      },
      {
        label: "Samples",
        value: data.summary.totalSamples.toString(),
      },
    ];
  }, [data]);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertTitle>Failed to load performance metrics</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-2">
          <span>Refresh to try again.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <SummaryGrid data={data} cards={summaryCards} />
        <MetricsChart
          metrics={data.latencySeries}
          title="Latency Trend"
          description="P95 and P99 latency across the selected window"
          unit="ms"
          height={220}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <MetricsChart
            metrics={data.errorRateSeries}
            title="Error Rate"
            description="Percentage of failed spans or traces per interval"
            unit="%"
            height={180}
          />
          <MetricsChart
            metrics={data.throughputSeries}
            title="Execution Rate"
            description="Runs per minute trend"
            height={180}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryGrid({
  data,
  cards,
}: {
  data: ContextualMetricsResponse;
  cards: { label: string; value: string }[];
}) {
  const timeframeMinutes = Math.max(
    1,
    (new Date(data.summary.timeframe.end).getTime() -
      new Date(data.summary.timeframe.start).getTime()) /
      60000
  );
  const throughput =
    data.summary.totalSamples > 0
      ? (data.summary.totalSamples / timeframeMinutes).toFixed(2)
      : "0.00";

  return (
    <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border border-border/60 bg-muted/30 p-3"
        >
          <p className="text-xs text-muted-foreground">{card.label}</p>
          <p className="text-sm font-semibold">{card.value}</p>
        </div>
      ))}
      <div className="rounded-lg border border-border/60 bg-muted/30 p-3 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Runs / minute</p>
        <p className="text-sm font-semibold flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          {throughput}
        </p>
        <p className="text-[10px] text-muted-foreground">
          Window: {new Date(data.summary.timeframe.start).toLocaleString()} →
          {new Date(data.summary.timeframe.end).toLocaleString()}
        </p>
      </div>
    </div>
  );
}
