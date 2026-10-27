import Link from "next/link";
import { Megaphone, Network } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { IncidentAssigneePicker } from "@/components/sre/incidents/incident-assignee-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableBadge } from "@/components/ui/table-badge";

function formatDate(value: Date | string | null) {
  if (!value) return "Not yet";
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right" suppressHydrationWarning>{children}</dd>
    </div>
  );
}

export function IncidentSidebar({ detail }: { detail: SreIncidentDetail }) {
  const { incident } = detail;
  const canUpdate = detail.permissions.canUpdate;
  return (
    <aside aria-label="Incident details" className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Ownership</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <IncidentAssigneePicker
            incidentId={incident.id}
            assigneeUserId={incident.commanderUserId}
            assigneeName={incident.commanderName}
            role="commander"
            label="Commander (optional)"
            canUpdate={canUpdate && incident.status !== "resolved"}
          />
          <dl className="space-y-2">
            <Row label="Service">
              {incident.primaryServiceId ? (
                <Link className="underline underline-offset-4" href={`/services/${incident.primaryServiceId}`}>
                  {incident.primaryServiceName ?? "Service"}
                </Link>
              ) : canUpdate ? (
                <Link className="underline underline-offset-4" href={`/incidents/${incident.id}?edit=service`}>Link service</Link>
              ) : "None"}
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Linked alerts</CardTitle></CardHeader>
        <CardContent>
          {detail.linkedAlerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts linked.</p>
          ) : (
            <ul className="space-y-2">
              {detail.linkedAlerts.map((alert) => (
                <li key={alert.id} className="flex items-start justify-between gap-2 text-sm">
                  <span className="min-w-0 break-words">{alert.title}</span>
                  <TableBadge compact tone={alert.status === "firing" ? "danger" : alert.status === "resolved" ? "success" : "neutral"}>{alert.status}</TableBadge>
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="ghost" size="sm" className="mt-3 h-7 px-0">
            <Link href={`/copilot/evidence-graph?incident=${incident.id}`}>
              <Network className="h-4 w-4" />
              View map
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Status page</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {detail.publicIncident ? (
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href={`/status-pages/${detail.publicIncident.statusPageId}/public/incidents/${detail.publicIncident.id}`}>
                View public status update
              </Link>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Not published.</p>
          )}
          {canUpdate && (
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href={detail.publicIncident ? `/status-pages/${detail.publicIncident.statusPageId}` : "/status-pages"}>
                <Megaphone className="h-4 w-4" />
                Publish update
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Timestamps</CardTitle></CardHeader>
        <CardContent>
          <dl className="space-y-2">
            <Row label="Detected">{formatDate(incident.createdAt)}</Row>
            <Row label="Acknowledged">
              {incident.acknowledgedAt ? `${formatDate(incident.acknowledgedAt)}${incident.acknowledgedByName ? ` by ${incident.acknowledgedByName}` : ""}` : "Not yet"}
            </Row>
            <Row label="Mitigated">{formatDate(incident.mitigatedAt)}</Row>
            <Row label="Resolved">{formatDate(incident.resolvedAt)}</Row>
            <Row label="MTTA">{formatDuration(incident.createdAt, incident.acknowledgedAt)}</Row>
            <Row label="MTTR">{formatDuration(incident.createdAt, incident.resolvedAt)}</Row>
          </dl>
        </CardContent>
      </Card>
    </aside>
  );
}
