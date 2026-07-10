"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import type { SreIncidentAnalytics as Analytics } from "@/actions/sre-incidents";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { TableBadge } from "@/components/ui/table-badge";

const chartConfig = {
  created: { label: "Created", color: "hsl(var(--chart-1))" },
  resolved: { label: "Resolved", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

function formatResolutionTime(minutes: number | null) {
  if (minutes === null) return "-";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function SreIncidentAnalytics({ analytics }: { analytics: Analytics }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Incident trends</h1>
        <p className="text-sm text-muted-foreground">
          Response volume and resolution performance for the last {analytics.windowDays} days.
        </p>
      </div>

      <div className="grid overflow-hidden rounded-lg border sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Created", analytics.summary.created],
          ["Resolved", analytics.summary.resolved],
          ["Resolution rate", `${analytics.summary.resolutionRate}%`],
          ["Average resolution", formatResolutionTime(analytics.summary.averageResolutionMinutes)],
        ].map(([label, value], index) => (
          <div key={label} className={index < 3 ? "border-b p-4 sm:border-r xl:border-b-0" : "p-4"}>
            <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Created and resolved</h2>
          <p className="text-sm text-muted-foreground">Daily incident flow in the selected project.</p>
        </div>
        <ChartContainer config={chartConfig} className="h-64 w-full">
          <LineChart data={analytics.daily} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={28} tickFormatter={(value) => value.slice(5)} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line type="monotone" dataKey="created" stroke="var(--color-created)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="resolved" stroke="var(--color-resolved)" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartContainer>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Severity mix</h2>
          <div className="divide-y rounded-lg border">
            {analytics.severities.length ? analytics.severities.map((item) => (
              <div key={item.severity} className="flex items-center justify-between px-4 py-3">
                <TableBadge tone={item.severity === "sev1" ? "danger" : item.severity === "sev2" || item.severity === "sev3" ? "warning" : "slate"} className="uppercase">
                  {item.severity}
                </TableBadge>
                <span className="text-sm font-semibold tabular-nums">{item.count}</span>
              </div>
            )) : <p className="px-4 py-6 text-sm text-muted-foreground">No incidents in this window.</p>}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Most affected services</h2>
          <div className="divide-y rounded-lg border">
            {analytics.topServices.length ? analytics.topServices.map((item) => (
              <div key={item.serviceId ?? "unmapped"} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="truncate text-sm font-medium">{item.serviceName}</span>
                <span className="text-sm font-semibold tabular-nums">{item.count}</span>
              </div>
            )) : <p className="px-4 py-6 text-sm text-muted-foreground">No service impact recorded.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
