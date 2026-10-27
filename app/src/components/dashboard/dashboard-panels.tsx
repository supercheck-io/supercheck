"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
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

/** Heading with the total and a link to the list, over a chart that fills the remaining height. */
function Section({
  title,
  total,
  href,
  linkLabel,
  testId,
  children,
}: {
  title: string;
  total: number | null;
  href: string;
  linkLabel: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} className="flex min-h-0 flex-1 flex-col first:pb-2 [&:not(:first-child)]:border-t [&:not(:first-child)]:pt-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          {title}
          {total !== null ? (
            <span className="ml-2 text-sm font-semibold tabular-nums text-foreground">{total}</span>
          ) : null}
        </h3>
        <Link href={href} className="text-xs text-muted-foreground hover:text-foreground">
          {linkLabel}
        </Link>
      </div>
      <div className="mt-1 min-h-0 flex-1">{children}</div>
    </section>
  );
}

function BarsOrEmpty({ data, empty }: { data: BarDatum[]; empty: string }) {
  if (data.every((d) => d.count === 0)) {
    return (
      <div className="flex h-full min-h-10 items-center justify-center text-sm text-muted-foreground">{empty}</div>
    );
  }
  return (
    <ChartContainer config={chartConfig} className="h-24 w-full lg:h-full lg:min-h-12">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={64} fontSize={11} tickLine={false} axisLine={false} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
          <Bar dataKey="count" radius={4} barSize={10}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
            <LabelList dataKey="count" position="right" fontSize={11} className="fill-muted-foreground" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

/**
 * Failed runs (last 7 days, by trigger) and open incidents (by severity). The
 * incidents section is omitted when the incidents API is unavailable (not
 * permitted or feature disabled).
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
  const failureData = failuresByTrigger(failedRuns);
  const failureTotal = failureData.reduce((sum, d) => sum + d.count, 0);
  const incidentData = incidentsBySeverity(incidentsResult?.available ? incidentsResult.incidents : []);
  // Totals come from the bars so an unrecognised severity can't make them disagree.
  const incidentTotal = incidentData.reduce((sum, d) => sum + d.count, 0);
  const showIncidents = incidentsLoading || !!incidentsResult?.available;

  return (
    <Card data-testid="panel-needs-attention" className="flex h-full min-h-0 flex-col">
      <CardHeader className="space-y-0 px-4 pb-2 pt-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          Needs attention
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-0">
        <Section
          testId="panel-recent-failures"
          title="Failed runs, last 7 days"
          total={failureTotal}
          href="/runs"
          linkLabel="All runs"
        >
          <BarsOrEmpty data={failureData} empty="No failed runs in the last 7 days" />
        </Section>
        {showIncidents ? (
          <Section
            testId="panel-open-incidents"
            title="Open incidents"
            total={incidentsLoading ? null : incidentTotal}
            href="/incidents"
            linkLabel="All incidents"
          >
            {incidentsLoading ? (
              <Skeleton className="h-full min-h-10 w-full" />
            ) : (
              <BarsOrEmpty data={incidentData} empty="No open incidents" />
            )}
          </Section>
        ) : null}
      </CardContent>
    </Card>
  );
}
