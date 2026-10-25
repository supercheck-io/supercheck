"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DashboardData } from "@/hooks/use-dashboard";
import type { OpenIncidentsResult } from "@/hooks/use-open-incidents";
import { selectRecentFailures } from "@/lib/dashboard/recent-failures";

const MAX_ROWS = 5;

function timeAgo(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  return formatDistanceToNow(time, { addSuffix: true });
}

const rowClass =
  "flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50";

const SEVERITY_LABEL: Record<string, string> = {
  sev1: "SEV1",
  sev2: "SEV2",
  sev3: "SEV3",
  sev4: "SEV4",
};

export type AttentionTab = "failures" | "incidents" | "alerts";

/** First tab that has something to show, so the card opens on what matters. */
export function pickDefaultAttentionTab(counts: {
  failures: number;
  incidents: number | null;
  alerts: number;
}): AttentionTab {
  if (counts.failures > 0) return "failures";
  if (counts.incidents !== null && counts.incidents > 0) return "incidents";
  if (counts.alerts > 0) return "alerts";
  return "failures";
}

function CountBadge({ count, tone }: { count: number | null; tone?: "bad" }) {
  if (count === null) return null;
  return (
    <Badge
      variant="secondary"
      title={String(count)}
      aria-label={`${count} items`}
      className={cn(
        "ml-1.5 h-4 min-w-4 justify-center px-1 text-[10px] tabular-nums",
        tone === "bad" && count > 0 && "bg-failure/15 text-failure"
      )}
    >
      {count > 99 ? "99+" : count}
    </Badge>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-16 items-center justify-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function ViewAll({ href, label = "View all" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="text-xs text-muted-foreground hover:text-foreground">
      {label}
    </Link>
  );
}

/**
 * One card for everything that needs a look: recent failed runs, open
 * incidents and recent alerts. The incidents tab is omitted when the incidents
 * API is unavailable (not permitted or feature disabled).
 */
export function NeedsAttentionCard({
  runs,
  alerts,
  incidentsResult,
  incidentsLoading,
}: {
  runs: DashboardData["jobs"]["recentRuns"];
  alerts: DashboardData["alerts"];
  incidentsResult: OpenIncidentsResult | undefined;
  incidentsLoading: boolean;
}) {
  const [selected, setSelected] = useState<AttentionTab | null>(null);
  const [latched, setLatched] = useState<AttentionTab | null>(null);

  const allFailures = selectRecentFailures(runs, Number.MAX_SAFE_INTEGER);
  const failures = allFailures.slice(0, MAX_ROWS);
  const showIncidents = incidentsLoading || (!!incidentsResult && incidentsResult.available);
  const incidentList =
    incidentsResult && incidentsResult.available ? incidentsResult.incidents : [];
  const incidentCount = incidentsLoading || !incidentsResult?.available ? null : incidentList.length;
  const alertRows = alerts.slice(0, MAX_ROWS);

  const fallback = pickDefaultAttentionTab({
    failures: allFailures.length,
    incidents: incidentCount,
    alerts: alerts.length,
  });
  // Latch the default once incidents have settled so refetches don't move the tab.
  const settled = !incidentsLoading;
  if (settled && latched === null) setLatched(fallback);
  const latchedOk = latched !== null && (latched !== "incidents" || showIncidents);
  const base = latchedOk ? latched : fallback;
  const active: AttentionTab = selected && (selected !== "incidents" || showIncidents) ? selected : base;

  const viewAll =
    active === "failures"
      ? { href: "/runs", label: "All runs" }
      : active === "incidents"
        ? { href: "/incidents", label: "View all" }
        : { href: "/alerts", label: "View all" };

  return (
    <Card data-testid="panel-needs-attention" className="flex h-full min-h-0 flex-col">
      <CardHeader className="space-y-0 px-4 pb-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            Needs attention
          </CardTitle>
          <ViewAll href={viewAll.href} label={viewAll.label} />
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-0">
        <Tabs
          value={active}
          onValueChange={(value) => setSelected(value as AttentionTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="h-8 w-full justify-start gap-1 p-0.5">
            <TabsTrigger value="failures" className="h-7 px-2.5 text-xs">
              Failures
              <CountBadge count={allFailures.length} tone="bad" />
            </TabsTrigger>
            {showIncidents ? (
              <TabsTrigger value="incidents" className="h-7 px-2.5 text-xs">
                Incidents
                <CountBadge count={incidentCount} tone="bad" />
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="alerts" className="h-7 px-2.5 text-xs">
              Alerts
              <CountBadge count={alerts.length} />
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="failures"
            data-testid="panel-recent-failures"
            className="mt-2 min-h-0 flex-1 overflow-y-auto"
          >
            {failures.length === 0 ? (
              <EmptyRow message="No failed runs in the last 30 days" />
            ) : (
              <ul className="-mx-2 space-y-0.5">
                {failures.map((run) => (
                  <li key={run.id}>
                    <Link href={`/runs/${run.id}`} className={rowClass}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-failure" aria-hidden />
                        <span className="truncate font-medium">{run.jobName || "Job run"}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {run.status} · {timeAgo(run.startedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {showIncidents ? (
            <TabsContent
              value="incidents"
              data-testid="panel-open-incidents"
              className="mt-2 min-h-0 flex-1 overflow-y-auto"
            >
              {incidentsLoading ? (
                <Skeleton className="h-full min-h-16 w-full" />
              ) : incidentList.length === 0 ? (
                <EmptyRow message="No open incidents" />
              ) : (
                <ul className="-mx-2 space-y-0.5">
                  {incidentList.slice(0, MAX_ROWS).map((incident) => (
                    <li key={incident.id}>
                      <Link href={`/incidents/${incident.id}`} className={rowClass}>
                        <span className="flex min-w-0 items-center gap-2">
                          <Badge variant="outline" className="shrink-0">
                            {SEVERITY_LABEL[incident.severity] ?? incident.severity}
                          </Badge>
                          <span className="truncate font-medium">{incident.title}</span>
                        </span>
                        <span className="shrink-0 text-xs capitalize text-muted-foreground">
                          {incident.status.replace(/_/g, " ")}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          ) : null}

          <TabsContent
            value="alerts"
            data-testid="panel-recent-alerts"
            className="mt-2 min-h-0 flex-1 overflow-y-auto"
          >
            {alertRows.length === 0 ? (
              <EmptyRow message="No alerts sent yet" />
            ) : (
              <ul className="-mx-2 space-y-0.5">
                {alertRows.map((alert) => (
                  <li key={alert.id}>
                    <Link href="/alerts" className={rowClass}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            alert.status === "sent" ? "bg-success" : "bg-failure"
                          )}
                          aria-hidden
                        />
                        <span className="truncate">
                          <span className="font-medium">{alert.targetName || alert.targetType}</span>
                          <span className="text-muted-foreground"> · {alert.type.replace(/_/g, " ")}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {timeAgo(alert.timestamp)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
