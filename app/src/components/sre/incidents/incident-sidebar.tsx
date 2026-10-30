"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { useSimilarIncidentCount } from "@/components/sre/incidents/similar-incidents-card";
import { IncidentAssigneePicker } from "@/components/sre/incidents/incident-assignee-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { Separator } from "@/components/ui/separator";
import { TableBadge } from "@/components/ui/table-badge";

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

function Row({ label, tip, children }: { label: string; tip?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-7 items-start justify-between gap-3 py-1 text-sm">
      <dt className="flex shrink-0 items-center gap-1 text-muted-foreground">{label}{tip}</dt>
      <dd className="min-w-0 break-words text-right" suppressHydrationWarning>{children}</dd>
    </div>
  );
}

/** The incident's properties in one compact card: people, links, alerts and timings. */
export function IncidentSidebar({
  detail,
  showCommander = false,
  onOpenSimilar,
}: {
  detail: SreIncidentDetail;
  /** The page's "Add commander" action reveals the commander picker. */
  showCommander?: boolean;
  /** Opens the similar-incidents list in the investigation sheet. */
  onOpenSimilar?: () => void;
}) {
  const { incident } = detail;
  const canUpdate = detail.permissions.canUpdate;
  const open = incident.status !== "resolved";
  const editable = canUpdate && open;
  const [allAlerts, setAllAlerts] = useState(false);
  const alerts = allAlerts ? detail.linkedAlerts : detail.linkedAlerts.slice(0, ALERTS_COLLAPSED);
  const similarCount = useSimilarIncidentCount(incident.id);

  return (
    <aside aria-labelledby="incident-details-title">
      <Card className="gap-4 py-4">
        <CardHeader className="px-4 pt-0 pb-1">
          <CardTitle id="incident-details-title" className="text-sm">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-4">
          <IncidentAssigneePicker
            incidentId={incident.id}
            assigneeUserId={incident.assigneeUserId}
            assigneeName={incident.assigneeName}
            assigneeImage={incident.assigneeImage}
            label="Assignee"
            canUpdate={editable}
          />
          {(incident.commanderUserId || showCommander) && (
            <IncidentAssigneePicker
              incidentId={incident.id}
              assigneeUserId={incident.commanderUserId}
              assigneeName={incident.commanderName}
              assigneeImage={incident.commanderImage}
              role="commander"
              label="Commander"
              canUpdate={editable}
            />
          )}

          <dl className="space-y-0.5">
            <Row label="Service">
              {incident.primaryServiceId ? (
                <Link className={PANEL_LINK} href={`/services/${incident.primaryServiceId}`}>
                  {incident.primaryServiceName ?? "Service"}
                </Link>
              ) : canUpdate ? (
                <Link className={PANEL_LINK} href={`/incidents/${incident.id}?edit=service`}>Link service</Link>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Row>
            <Row label="Status page">
              {detail.publicIncident ? (
                <span className="flex items-center justify-end gap-2">
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
            <Row label="Started">{formatDate(incident.createdAt)}</Row>
            <Row label="Acknowledged">
              {incident.acknowledgedAt ? (
                <span title={incident.acknowledgedByName ? `by ${incident.acknowledgedByName}` : undefined}>
                  {formatDate(incident.acknowledgedAt)}
                  {incident.acknowledgedByName && <span className="text-muted-foreground"> by {incident.acknowledgedByName}</span>}
                </span>
              ) : (
                <span className="text-muted-foreground">{incident.resolvedAt ? "Skipped" : "Not yet"}</span>
              )}
            </Row>
            {incident.acknowledgedAt && (
              <Row label="Time to acknowledge" tip={<InfoTip label="About time to acknowledge">From opened to first acknowledgement.</InfoTip>}>
                {formatDuration(incident.createdAt, incident.acknowledgedAt)}
              </Row>
            )}
            {incident.resolvedAt && (
              <Row label="Time to resolve" tip={<InfoTip label="About time to resolve">From opened to resolved.</InfoTip>}>
                {formatDuration(incident.createdAt, incident.resolvedAt)}
              </Row>
            )}
          </dl>

          <Separator />

          <section aria-labelledby="incident-alerts-title" className="space-y-1.5">
            <h3 id="incident-alerts-title" className="flex items-center justify-between text-sm font-medium">
              Alerts
              <span className="text-xs font-normal tabular-nums text-muted-foreground">{detail.linkedAlerts.length}</span>
            </h3>
            {detail.linkedAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No alerts linked.</p>
            ) : (
              <>
                <ul className="space-y-1.5">
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
                    className="rounded-sm text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {allAlerts ? "Show fewer" : `View all ${detail.linkedAlerts.length}`}
                  </button>
                )}
              </>
            )}
          </section>

          {similarCount !== null && similarCount > 0 && onOpenSimilar && (
            <>
              <Separator />
              <button
                type="button"
                onClick={onOpenSimilar}
                className="flex w-full items-center justify-between rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>Similar past incidents</span>
                <span className="flex items-center gap-1 tabular-nums">
                  {similarCount}
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </button>
            </>
          )}
        </CardContent>
      </Card>
    </aside>
  );
}
