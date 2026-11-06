"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, ListTree } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { IncidentAssigneePicker } from "@/components/sre/incidents/incident-assignee-picker";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { useNow } from "@/components/sre/incidents/incident-age";
import { Metric, SectionTitle } from "@/components/sre/incidents/incident-ui";
import { WatchSreIncidentButton } from "@/components/sre/incidents/watch-sre-incident-button";

const ALERTS_COLLAPSED = 3;

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function formatDuration(from: Date | string | null, to: Date | string | null) {
  if (!from || !to) return "N/A";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "N/A";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

// One link style for every in-panel link.
export const PANEL_LINK = "font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

export const SEVERITY_TONES: Record<SreIncidentDetail["incident"]["severity"], TableBadgeTone> = {
  sev1: "danger",
  sev2: "warning",
  sev3: "warning",
  sev4: "slate",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-8 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words" suppressHydrationWarning>{children}</dd>
    </div>
  );
}

/** The right-hand column: timings, people, service, status page and watch, then linked alerts. Status and severity are in the page header. */
export function IncidentSidebar({
  detail,
  showCommander = false,
}: {
  detail: SreIncidentDetail;
  /** The page's "Add commander" action reveals the commander picker. */
  showCommander?: boolean;
}) {
  const { incident } = detail;
  const canUpdate = detail.permissions.canUpdate;
  const open = incident.status !== "resolved";
  const editable = canUpdate && open;
  const [allAlerts, setAllAlerts] = useState(false);
  const alerts = allAlerts ? detail.linkedAlerts : detail.linkedAlerts.slice(0, ALERTS_COLLAPSED);
  const now = useNow();
  const firing = detail.linkedAlerts.filter((alert) => alert.status === "firing").length;

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3 py-4 shadow-none">
        <CardHeader className="px-4 pt-0 pb-0">
          <SectionTitle id="incident-details-title" as="h2" icon={ListTree} tone="slate">Properties</SectionTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-4">
          <dl className="grid grid-cols-2 gap-2">
            <Metric
              label="Time to acknowledge"
              title={
                incident.acknowledgedAt
                  ? `Acknowledged ${formatDate(incident.acknowledgedAt)}${incident.acknowledgedByName ? ` by ${incident.acknowledgedByName}` : ""}`
                  : "Time to acknowledge"
              }
            >
              {incident.acknowledgedAt ? (
                formatDuration(incident.createdAt, incident.acknowledgedAt)
              ) : (
                <span className="font-normal text-muted-foreground">{incident.resolvedAt ? "Skipped" : "Not yet"}</span>
              )}
            </Metric>
            {incident.resolvedAt ? (
              <Metric label="Time to resolve">{formatDuration(incident.createdAt, incident.resolvedAt)}</Metric>
            ) : (
              <Metric label="Open for">{formatDuration(incident.createdAt, new Date(now))}</Metric>
            )}
          </dl>
          <dl className="space-y-0.5">
            <Row label="Assignee">
              <IncidentAssigneePicker
                incidentId={incident.id}
                assigneeUserId={incident.assigneeUserId}
                assigneeName={incident.assigneeName}
                assigneeImage={incident.assigneeImage}
                label="Assignee"
                hideLabel
                canUpdate={editable}
              />
            </Row>
            {(incident.commanderUserId || showCommander) && (
              <Row label="Commander">
                <IncidentAssigneePicker
                  incidentId={incident.id}
                  assigneeUserId={incident.commanderUserId}
                  assigneeName={incident.commanderName}
                  assigneeImage={incident.commanderImage}
                  role="commander"
                  label="Commander"
                  hideLabel
                  canUpdate={editable}
                />
              </Row>
            )}
            <Row label="Service">
              {incident.primaryServiceId ? (
                <Link className={PANEL_LINK} href={`/services/${incident.primaryServiceId}`}>
                  {incident.primaryServiceName ?? "Service"}
                </Link>
              ) : canUpdate ? (
                <Link className={PANEL_LINK} href={`/incidents/${incident.id}?edit=service`}>Link service</Link>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </Row>
            <Row label="Started">{formatDate(incident.createdAt)}</Row>
            <Row label="Alerts">
              {incident.alertCount}
              {incident.lastAlertAt ? ` (last ${formatDate(incident.lastAlertAt)})` : ""}
            </Row>
            <Row label="Status page">
              {detail.publicIncident ? (
                <span className="flex flex-wrap items-center gap-x-2">
                  <Link
                    className={PANEL_LINK}
                    href={`/status-pages/${detail.publicIncident.statusPageId}/public/incidents/${detail.publicIncident.id}`}
                  >
                    <span className="capitalize">{detail.publicIncident.status.replace(/_/g, " ")}</span>
                  </Link>
                  {canUpdate && (
                    <>
                      <span aria-hidden="true" className="text-muted-foreground">·</span>
                      <Link className={PANEL_LINK} href={`/status-pages/${detail.publicIncident.statusPageId}`}>
                        Post update
                      </Link>
                    </>
                  )}
                </span>
              ) : canUpdate ? (
                <Link className={PANEL_LINK} href="/status-pages">Post update</Link>
              ) : (
                <span className="text-muted-foreground">Not published</span>
              )}
            </Row>
            <Row label="Notifications">
              <WatchSreIncidentButton incidentId={incident.id} watching={detail.watching ?? false} />
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card className="gap-3 py-4 shadow-none">
        <CardHeader className="px-4 pt-0 pb-0">
          <SectionTitle
            id="incident-alerts-title"
            as="h2"
            icon={Bell}
            tone={firing > 0 ? "rose" : "slate"}
            count={detail.linkedAlerts.length}
          >
            Alerts
          </SectionTitle>
        </CardHeader>
        <CardContent className="px-4">
          {detail.linkedAlerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts linked.</p>
          ) : (
            <>
              <ul className="space-y-2">
                {alerts.map((alert) => (
                  <li key={alert.id} className="flex items-start justify-between gap-2 text-sm">
                    <span className="min-w-0 break-words">{alert.title}</span>
                    <TableBadge compact tone={alert.status === "firing" ? "danger" : alert.status === "resolved" ? "success" : "neutral"}>
                      <span className="capitalize">{alert.status}</span>
                    </TableBadge>
                  </li>
                ))}
              </ul>
              {detail.linkedAlerts.length > ALERTS_COLLAPSED && (
                <button
                  type="button"
                  aria-expanded={allAlerts}
                  onClick={() => setAllAlerts((value) => !value)}
                  className="mt-2 rounded-sm text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {allAlerts ? "Show fewer" : `View all ${detail.linkedAlerts.length}`}
                </button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
