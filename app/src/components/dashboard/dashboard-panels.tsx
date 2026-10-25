"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

function PanelShell({
  title,
  description,
  viewAllHref,
  viewAllLabel,
  children,
  testId,
}: {
  title: string;
  description: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <Card data-testid={testId} className="h-full">
      <CardHeader className="space-y-1 px-4 pb-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {viewAllHref ? (
            <Link
              href={viewAllHref}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {viewAllLabel ?? "View all"}
            </Link>
          ) : null}
        </div>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2">{children}</CardContent>
    </Card>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

const rowClass =
  "flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50";

export function RecentFailuresPanel({
  runs,
}: {
  runs: DashboardData["jobs"]["recentRuns"];
}) {
  const failures = selectRecentFailures(runs, MAX_ROWS);
  return (
    <PanelShell
      testId="panel-recent-failures"
      title="Recent failures"
      description="Failed job runs, last 30 days"
      viewAllHref="/runs"
      viewAllLabel="All runs"
    >
      {failures.length === 0 ? (
        <EmptyRow message="No failures in the last 30 days" />
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
    </PanelShell>
  );
}

const SEVERITY_LABEL: Record<string, string> = {
  sev1: "SEV1",
  sev2: "SEV2",
  sev3: "SEV3",
  sev4: "SEV4",
};

/** Hidden entirely when the incidents API is not permitted or the feature is disabled. */
export function OpenIncidentsPanel({
  result,
  isLoading,
}: {
  result: OpenIncidentsResult | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <PanelShell testId="panel-open-incidents" title="Open incidents" description="Unresolved incidents in this project">
        <Skeleton className="h-32 w-full" />
      </PanelShell>
    );
  }
  if (!result || !result.available) return null;

  const incidents = result.incidents.slice(0, MAX_ROWS);
  return (
    <PanelShell
      testId="panel-open-incidents"
      title="Open incidents"
      description="Unresolved incidents in this project"
      viewAllHref="/incidents"
    >
      {incidents.length === 0 ? (
        <EmptyRow message="No open incidents" />
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {incidents.map((incident) => (
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
    </PanelShell>
  );
}

export function RecentAlertsPanel({
  alerts,
}: {
  alerts: DashboardData["alerts"];
}) {
  const rows = alerts.slice(0, MAX_ROWS);
  return (
    <PanelShell
      testId="panel-recent-alerts"
      title="Recent alerts"
      description="Latest monitor and job notifications"
      viewAllHref="/alerts"
    >
      {rows.length === 0 ? (
        <EmptyRow message="No alerts sent yet" />
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {rows.map((alert) => (
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
    </PanelShell>
  );
}
