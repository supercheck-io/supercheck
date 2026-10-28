"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DashboardData } from "@/hooks/use-dashboard";
import type { OpenIncidentsResult } from "@/hooks/use-open-incidents";

const chartConfig = {
  count: { label: "Count", color: "var(--chart-1)" },
};

const SEVERITIES = [
  { key: "sev1", name: "SEV1", fill: "var(--failure)" },
  { key: "sev2", name: "SEV2", fill: "var(--warning)" },
  { key: "sev3", name: "SEV3", fill: "var(--chart-1)" },
  { key: "sev4", name: "SEV4", fill: "var(--chart-2)" },
] as const;

// Same trigger colors as the Job Activity chart.
const TRIGGERS = [
  { key: "manual", name: "Manual", fill: "var(--chart-2)" },
  { key: "scheduled", name: "Scheduled", fill: "var(--chart-1)" },
  { key: "remote", name: "API", fill: "var(--chart-3)" },
] as const;

type BarDatum = { name: string; count: number; fill: string };

export function failuresByTrigger(failed: DashboardData["jobs"]["failedRuns7d"]): BarDatum[] {
  return TRIGGERS.map(({ key, name, fill }) => ({ name, fill, count: failed[key] }));
}

export function incidentsBySeverity(incidents: Array<{ severity: string }>): BarDatum[] {
  return SEVERITIES.map(({ key, name, fill }) => ({
    name,
    fill,
    count: incidents.filter((incident) => incident.severity === key).length,
  }));
}

function StatusBars({ data, empty }: { data: BarDatum[]; empty: string }) {
  if (data.every((d) => d.count === 0)) {
    return (
      <div className="flex h-44 items-center justify-center text-sm text-muted-foreground lg:h-full">{empty}</div>
    );
  }
  // Same chart as Job Status and Monitor Status.
  return (
    <ChartContainer config={chartConfig} className="h-44 w-full lg:h-full lg:min-h-20">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="name" fontSize={11} tickLine={false} />
          <YAxis fontSize={11} allowDecimals={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

/**
 * Failed runs (last 7 days, by trigger) and open incidents (by severity), one tab each.
 * The incidents tab is omitted when the incidents API is unavailable (not permitted or
 * feature disabled).
 */
export function NeedsAttentionCard({
  failedRuns,
  incidentsResult,
  incidentsLoading,
}: {
  failedRuns: DashboardData["jobs"]["failedRuns7d"];
  incidentsResult: OpenIncidentsResult | undefined;
  incidentsLoading: boolean;
}) {
  const [tab, setTab] = useState<"runs" | "incidents" | null>(null);
  const failureData = failuresByTrigger(failedRuns);
  const failureTotal = failureData.reduce((sum, d) => sum + d.count, 0);
  const incidentData = incidentsBySeverity(incidentsResult?.available ? incidentsResult.incidents : []);
  // Totals come from the bars so an unrecognised severity can't make them disagree.
  const incidentTotal = incidentData.reduce((sum, d) => sum + d.count, 0);
  const showIncidents = incidentsLoading || !!incidentsResult?.available;
  // Open incidents come first; failed runs are the default only when nothing is open.
  const active = showIncidents ? (tab ?? (incidentTotal > 0 ? "incidents" : "runs")) : "runs";
  const description =
    active === "runs"
      ? `${failureTotal} failed ${failureTotal === 1 ? "run" : "runs"} by trigger, last 7 days`
      : incidentsLoading
        ? "Open incidents by severity"
        : `${incidentTotal} open ${incidentTotal === 1 ? "incident" : "incidents"} by severity`;

  return (
    <Card data-testid="panel-needs-attention" className="flex h-full min-h-0 flex-col">
      <CardHeader className="space-y-1 px-4 pb-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            Needs attention
          </CardTitle>
          {showIncidents ? (
            <Tabs value={active} onValueChange={(value) => setTab(value as "runs" | "incidents")}>
              <TabsList className="h-7">
                <TabsTrigger value="runs" className="h-5 px-2 text-xs">Runs</TabsTrigger>
                <TabsTrigger value="incidents" className="h-5 px-2 text-xs">Incidents</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
        </div>
        <CardDescription className="flex justify-between gap-2 text-xs [@media(max-height:760px)]:hidden">
          <span className="truncate">{description}</span>
          <Link href={active === "runs" ? "/runs" : "/incidents"} className="shrink-0 hover:text-foreground">
            {active === "runs" ? "All runs" : "All incidents"}
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2 lg:min-h-0 lg:flex-1">
        {active === "runs" ? (
          <div data-testid="panel-recent-failures" className="h-full">
            <StatusBars data={failureData} empty="No failed runs in the last 7 days" />
          </div>
        ) : (
          <div data-testid="panel-open-incidents" className="h-full">
            {incidentsLoading ? (
              <Skeleton className="h-44 w-full lg:h-full" />
            ) : (
              <StatusBars data={incidentData} empty="No open incidents" />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
