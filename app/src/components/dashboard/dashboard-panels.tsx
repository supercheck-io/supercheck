"use client";

import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { useState, type ReactNode } from "react";
import { AlertTriangle, Bell, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DashboardData } from "@/hooks/use-dashboard";
import type { OpenIncidentsResult } from "@/hooks/use-open-incidents";

const MAX_ROWS = 5;

function timeAgo(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  return formatDistanceToNowStrict(time, { addSuffix: true });
}

// overflow-x-hidden: the list sits in a vertical scroller, so nothing may widen it.
const panelClass = "mt-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden";
const listClass = "divide-y divide-border/60";

const TRIGGER_LABEL: Record<string, string> = {
  manual: "Manual run",
  schedule: "Scheduled run",
  remote: "API run",
};

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Icon, a title over a muted detail line, and the time on the right. */
function AttentionRow({
  href,
  lead,
  title,
  meta,
  time,
}: {
  href: string;
  lead: ReactNode;
  title: string;
  meta: string;
  time: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-md px-1 py-2 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex w-9 shrink-0 justify-center">{lead}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {meta ? <span className="block truncate text-xs text-muted-foreground">{meta}</span> : null}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{timeAgo(time)}</span>
    </Link>
  );
}

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
  failures,
  failureCount,
  alerts,
  incidentsResult,
  incidentsLoading,
}: {
  failures: DashboardData["jobs"]["recentFailures"];
  /** All failed runs in the window; `failures` holds only the newest few. */
  failureCount: number;
  alerts: DashboardData["alerts"];
  incidentsResult: OpenIncidentsResult | undefined;
  incidentsLoading: boolean;
}) {
  const [selected, setSelected] = useState<AttentionTab | null>(null);
  const [latched, setLatched] = useState<AttentionTab | null>(null);

  const showIncidents = incidentsLoading || (!!incidentsResult && incidentsResult.available);
  const incidentList =
    incidentsResult && incidentsResult.available ? incidentsResult.incidents : [];
  const incidentCount = incidentsLoading || !incidentsResult?.available ? null : incidentList.length;
  const alertRows = alerts.slice(0, MAX_ROWS);

  const fallback = pickDefaultAttentionTab({
    failures: failureCount,
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
              <CountBadge count={failureCount} tone="bad" />
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

          <TabsContent value="failures" data-testid="panel-recent-failures" className={panelClass}>
            {failures.length === 0 ? (
              <EmptyRow message="No failed runs in the last 30 days" />
            ) : (
              <ul className={listClass}>
                {failures.slice(0, MAX_ROWS).map((run) => (
                  <li key={run.id}>
                    <AttentionRow
                      href={`/runs/${run.id}`}
                      lead={<XCircle className="h-4 w-4 text-failure" aria-hidden />}
                      title={run.jobName || "Job run"}
                      meta={`${capitalize(run.status)} · ${TRIGGER_LABEL[run.trigger] ?? "Manual run"}`}
                      time={run.startedAt}
                    />
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          {showIncidents ? (
            <TabsContent value="incidents" data-testid="panel-open-incidents" className={panelClass}>
              {incidentsLoading ? (
                <Skeleton className="h-full min-h-16 w-full" />
              ) : incidentList.length === 0 ? (
                <EmptyRow message="No open incidents" />
              ) : (
                <ul className={listClass}>
                  {incidentList.slice(0, MAX_ROWS).map((incident) => (
                    <li key={incident.id}>
                      <AttentionRow
                        href={`/incidents/${incident.id}`}
                        lead={
                          <span className="rounded bg-failure/15 px-1 py-px text-[10px] font-semibold leading-4 text-failure">
                            {SEVERITY_LABEL[incident.severity] ?? incident.severity.toUpperCase()}
                          </span>
                        }
                        title={incident.title}
                        meta={[capitalize(incident.status.replace(/_/g, " ")), incident.primaryServiceName]
                          .filter(Boolean)
                          .join(" · ")}
                        time={incident.updatedAt}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          ) : null}

          <TabsContent value="alerts" data-testid="panel-recent-alerts" className={panelClass}>
            {alertRows.length === 0 ? (
              <EmptyRow message="No alerts sent yet" />
            ) : (
              <ul className={listClass}>
                {alertRows.map((alert) => (
                  <li key={alert.id}>
                    <AttentionRow
                      href="/alerts"
                      lead={
                        <Bell
                          className={cn("h-4 w-4", alert.status === "sent" ? "text-muted-foreground" : "text-failure")}
                          aria-hidden
                        />
                      }
                      title={alert.targetName || capitalize(alert.targetType)}
                      meta={`${capitalize(alert.type.replace(/_/g, " "))}${alert.status === "sent" ? "" : " · not delivered"}`}
                      time={alert.timestamp}
                    />
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
