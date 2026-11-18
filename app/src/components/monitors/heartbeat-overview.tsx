"use client";

import type { ReactNode } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatHeartbeatMinutes, formatPingAgo, formatPingDue } from "./heartbeat-format";

const STAMP = "MMM d, yyyy HH:mm:ss";

function Fact({ label, testId, tooltip, children }: { label: string; testId?: string; tooltip?: string; children: ReactNode }) {
  const value = <span data-testid={testId}>{children}</span>;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold">
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{value}</span>
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

const dash = <span className="text-muted-foreground">—</span>;

interface HeartbeatOverviewProps {
  state: string;
  frequencyMinutes: number;
  graceMinutes: number;
  lastPingAt?: string | Date | null;
  nextExpectedAt?: string | Date | null;
  /** Formatted duration of the latest run, null when the job never calls /start. */
  lastRunDuration: string | null;
  uptime24h: string | null;
  uptime30d: string | null;
  /** Ticking clock for the relative times. */
  now: number;
}

/** Key facts of a heartbeat: schedule, last and next ping, run duration and uptime. */
export function HeartbeatOverview({ state, frequencyMinutes, graceMinutes, lastPingAt, nextExpectedAt, lastRunDuration, uptime24h, uptime30d, now }: HeartbeatOverviewProps) {
  const last = lastPingAt ? new Date(lastPingAt) : null;
  const next = nextExpectedAt ? new Date(nextExpectedAt) : null;
  return (
    <Card className="shadow-sm" data-testid="heartbeat-overview">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
          <Fact label="Expected every">{formatHeartbeatMinutes(frequencyMinutes)}</Fact>
          <Fact label="Grace period">{formatHeartbeatMinutes(graceMinutes)}</Fact>
          <Fact label="Last ping" testId="heartbeat-stat-last-ping" tooltip={last ? format(last, STAMP) : undefined}>
            {last ? formatPingAgo(last, now) : "No pings yet"}
          </Fact>
          <Fact label="Next ping" testId="heartbeat-stat-next" tooltip={state !== "paused" && last && next ? format(next, STAMP) : undefined}>
            {state === "paused" ? "Paused" : last && next ? formatPingDue(next, now) : dash}
          </Fact>
          <Fact label="Last run" testId="heartbeat-stat-duration" tooltip={lastRunDuration ? undefined : "Call /start to record duration"}>
            {lastRunDuration ?? dash}
          </Fact>
          <Fact label="Uptime 24h">{uptime24h ?? dash}</Fact>
          <Fact label="Uptime 30d">{uptime30d ?? dash}</Fact>
        </dl>
      </CardContent>
    </Card>
  );
}
