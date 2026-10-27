"use client";

import { format } from "date-fns";
import { Activity, Boxes, Siren } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, Cell, XAxis, YAxis } from "recharts";

import type { SreIncidentAnalytics as Analytics } from "@/actions/sre-incidents";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const chartConfig = {
  created: { label: "Created", color: "var(--chart-1)" },
  resolved: { label: "Resolved", color: "var(--chart-2)" },
  count: { label: "Incidents", color: "var(--chart-1)" },
} satisfies ChartConfig;

// Same severity colors as the dashboard's open-incidents chart.
const SEVERITY_FILL: Record<string, string> = {
  sev1: "var(--failure)",
  sev2: "var(--warning)",
  sev3: "var(--chart-1)",
  sev4: "var(--chart-2)",
};

const DAY_AXIS = {
  interval: "preserveStartEnd" as const,
  minTickGap: 24,
  tickLine: false,
  fontSize: 11,
};

const mutedIcon = "h-4 w-4 text-muted-foreground";
const chartClass = "h-44 w-full lg:h-full lg:min-h-20";

function formatResolutionTime(minutes: number | null) {
  if (minutes === null) return "-";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

/** "2026-09-27" -> "Sep 27". Parsed as a calendar date so it never shifts with the viewer's timezone. */
export function formatTrendDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? value : format(date, "MMM d");
}

// Same card as the dashboard's chart cards.
function ChartCard({
  title,
  description,
  icon,
  className,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={`flex h-full min-h-0 flex-col ${className ?? ""}`}>
      <CardHeader className="space-y-1 px-4 pb-2 pt-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </CardTitle>
        <CardDescription className="line-clamp-1 text-xs [@media(max-height:760px)]:hidden" title={description}>
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2 lg:min-h-0 lg:flex-1">{children}</CardContent>
    </Card>
  );
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-44 items-center justify-center text-sm text-muted-foreground lg:h-full">{message}</div>
  );
}

function StatusBars({ data, empty }: { data: Array<{ name: string; count: number; fill: string }>; empty: string }) {
  if (data.length === 0) return <ChartEmpty message={empty} />;
  return (
    <ChartContainer config={chartConfig} className={chartClass}>
      <BarChart data={data} accessibilityLayer>
        <XAxis dataKey="name" fontSize={11} tickLine={false} interval={0} />
        <YAxis fontSize={11} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function SreIncidentAnalytics({ analytics }: { analytics: Analytics }) {
  const { summary, windowDays } = analytics;
  const severityData = analytics.severities.map((item) => ({
    name: item.severity.toUpperCase(),
    count: item.count,
    fill: SEVERITY_FILL[item.severity] ?? "var(--chart-3)",
  }));
  const serviceData = analytics.topServices.map((item) => ({
    name: item.serviceName,
    count: item.count,
    fill: "var(--chart-1)",
  }));
  const hasFlow = analytics.daily.some((day) => day.created > 0 || day.resolved > 0);

  return (
    <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1">
      <PageHeader
        title="Incident trends"
        description={`Incident volume and resolution over the last ${windowDays} days.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Created" value={String(summary.created)} caption={`Last ${windowDays} days`} href="/incidents" />
        <MetricCard title="Resolved" value={String(summary.resolved)} caption={`Last ${windowDays} days`} />
        <MetricCard title="Resolution rate" value={`${summary.resolutionRate}%`} caption="Resolved of created" />
        <MetricCard
          title="Average resolution"
          value={formatResolutionTime(summary.averageResolutionMinutes)}
          caption="From created to resolved"
        />
      </div>

      <div className="grid gap-4 lg:min-h-0 lg:flex-[1.3] lg:grid-rows-[minmax(0,1fr)]">
        <ChartCard title="Created and resolved" description="Daily incidents created and resolved" icon={<Activity className={mutedIcon} />}>
          {hasFlow ? (
            <ChartContainer config={chartConfig} className={chartClass}>
              <AreaChart data={analytics.daily} accessibilityLayer>
                <XAxis dataKey="date" {...DAY_AXIS} tickFormatter={(value) => formatTrendDate(String(value))} />
                <YAxis fontSize={11} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => formatTrendDate(String(value))} />} />
                <Area type="monotone" dataKey="created" stroke="var(--color-created)" fill="var(--color-created)" fillOpacity={0.3} />
                <Area type="monotone" dataKey="resolved" stroke="var(--color-resolved)" fill="var(--color-resolved)" fillOpacity={0.3} />
              </AreaChart>
            </ChartContainer>
          ) : (
            <ChartEmpty message="No incidents in this window" />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
        <ChartCard title="Severity" description="Incidents by severity" icon={<Siren className={mutedIcon} />}>
          <StatusBars data={severityData} empty="No incidents in this window" />
        </ChartCard>
        <ChartCard title="Most affected services" description="Incidents per service" icon={<Boxes className={mutedIcon} />}>
          <StatusBars data={serviceData} empty="No service impact recorded" />
        </ChartCard>
      </div>
    </div>
  );
}
