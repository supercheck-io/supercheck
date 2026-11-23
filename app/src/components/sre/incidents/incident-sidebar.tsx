"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, ListTree } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { IncidentAssigneePicker } from "@/components/sre/incidents/incident-assignee-picker";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { useNow } from "@/components/sre/incidents/incident-age";
import { Metric, PANEL_CARD, PANEL_CONTENT, PANEL_HEADER, SectionTitle } from "@/components/sre/incidents/incident-ui";
import { WatchSreIncidentButton } from "@/components/sre/incidents/watch-sre-incident-button";
import { IncidentFormDialog } from "@/components/status-pages/incident-form-dialog";
import { useProjectContext } from "@/hooks/use-project-context";
import { getSreIncidentDetailQueryKey, getSreIncidentTimelineQueryKey } from "@/lib/sre/query-keys";

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
// Always underlined: in dark mode text-primary is near-white and would read as a plain value.
export const PANEL_LINK = "font-medium text-primary underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

export const SEVERITY_TONES: Record<SreIncidentDetail["incident"]["severity"], TableBadgeTone> = {
  sev1: "danger",
  sev2: "warning",
  sev3: "warning",
  sev4: "slate",
};

function Row({ label, children, multiline = false }: { label: string; children: React.ReactNode; multiline?: boolean }) {
  // A multi-line value starts level with its label, at the same height a one-line row centres on.
  const align = multiline ? "items-start [&>*]:py-1.5" : "items-center";
  return (
    <div className={`grid min-h-8 grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 text-sm ${align}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words" suppressHydrationWarning>{children}</dd>
    </div>
  );
}

/** Posts a new public incident linked to this one, on a page that has none yet; also the retry for a failed declare-time post. */
function PostToStatusPage({ incident, excludeStatusPageIds }: { incident: { id: string; title: string }; excludeStatusPageIds: string[] }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  return (
    <>
      <button type="button" className={PANEL_LINK} onClick={() => setOpen(true)}>
        Post to status page
      </button>
      <IncidentFormDialog
        open={open}
        onOpenChange={setOpen}
        sreIncident={{ id: incident.id, title: incident.title }}
        excludeStatusPageIds={excludeStatusPageIds}
        onSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: getSreIncidentDetailQueryKey(projectId, incident.id) });
          void queryClient.invalidateQueries({ queryKey: getSreIncidentTimelineQueryKey(projectId, incident.id) });
        }}
      />
    </>
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
  const publicIncidents = detail.publicIncidents ?? [];
  const canPost = Boolean(detail.permissions.canPostToStatusPage);

  return (
    <div className="flex flex-col gap-4">
      <Card className={PANEL_CARD}>
        <CardHeader className={PANEL_HEADER}>
          <SectionTitle id="incident-details-title" as="h2" icon={ListTree} tone="slate">Properties</SectionTitle>
        </CardHeader>
        <CardContent className={`space-y-3 ${PANEL_CONTENT}`}>
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
            {(detail.affectedResources?.length ?? 0) > 0 && (
              <Row label="Affected">
                <ul className="flex flex-col gap-0.5" data-testid="incident-affected">
                  {detail.affectedResources!.map((resource) => (
                    <li key={`${resource.type}:${resource.id}`} className="min-w-0 truncate">
                      <Link className={PANEL_LINK} href={resource.type === "service" ? `/services/${resource.id}` : `/monitors/${resource.id}`}>
                        {resource.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Row>
            )}
            <Row label="Started">{formatDate(incident.createdAt)}</Row>
            {/* alertCount counts every firing, repeats included; the Alerts card lists each distinct alert once. */}
            <Row label="Fired">
              {incident.alertCount} {incident.alertCount === 1 ? "time" : "times"}
              {incident.lastAlertAt ? ` (last ${formatDate(incident.lastAlertAt)})` : ""}
            </Row>
            <Row label={publicIncidents.length > 1 ? "Status pages" : "Status page"} multiline={publicIncidents.length > 0}>
              {publicIncidents.length === 0 && !(editable && canPost) ? (
                <span className="text-muted-foreground">Not published</span>
              ) : (
                <ul className="flex flex-col gap-0.5" data-testid="incident-status-pages">
                  {publicIncidents.map((post) => (
                    <li key={post.id} className="flex min-w-0 flex-wrap items-center gap-x-2">
                      {/* The page's Status updates tab, where its post is updated; the status opens the public post. */}
                      <Link className={`${PANEL_LINK} min-w-0 truncate`} href={`/status-pages/${post.statusPageId}?tab=incidents`}>
                        {post.statusPageName}
                      </Link>
                      <span aria-hidden="true" className="text-muted-foreground">·</span>
                      <Link
                        className={PANEL_LINK}
                        href={`/status-pages/${post.statusPageId}/public/incidents/${post.id}`}
                        // The preview has no app navigation, so it opens beside the incident.
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span className="capitalize">{post.status.replace(/_/g, " ")}</span>
                      </Link>
                    </li>
                  ))}
                  {editable && canPost && (
                    <li>
                      <PostToStatusPage
                        incident={incident}
                        excludeStatusPageIds={publicIncidents.map((post) => post.statusPageId)}
                      />
                    </li>
                  )}
                </ul>
              )}
            </Row>
            <Row label="Notifications">
              <WatchSreIncidentButton incidentId={incident.id} watching={detail.watching ?? false} />
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card className={PANEL_CARD}>
        <CardHeader className={PANEL_HEADER}>
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
        <CardContent className={PANEL_CONTENT}>
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
