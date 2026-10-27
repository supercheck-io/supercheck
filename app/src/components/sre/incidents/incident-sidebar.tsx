"use client";

import { useState } from "react";
import Link from "next/link";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { SimilarIncidentsCard } from "@/components/sre/incidents/similar-incidents-card";
import { IncidentAssigneePicker } from "@/components/sre/incidents/incident-assignee-picker";
import { formatAgo } from "@/components/sre/incidents/incident-age";
import { InfoTip } from "@/components/ui/info-tip";
import { TableBadge } from "@/components/ui/table-badge";

const ALERTS_COLLAPSED = 3;

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

function Section({ title, tip, tipLabel, aside, children }: { title: string; tip: string; tipLabel: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t pt-3 first:border-t-0 first:pt-0">
      <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
        <InfoTip label={tipLabel}>{tip}</InfoTip>
        {aside !== undefined && <span className="ml-auto tabular-nums normal-case tracking-normal">{aside}</span>}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, tip, children }: { label: string; tip?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="flex items-center gap-1 text-muted-foreground">{label}{tip}</dt>
      <dd className="min-w-0 text-right" suppressHydrationWarning>{children}</dd>
    </div>
  );
}

export function IncidentSidebar({ detail }: { detail: SreIncidentDetail }) {
  const { incident } = detail;
  const canUpdate = detail.permissions.canUpdate;
  const open = incident.status !== "resolved";
  const editable = canUpdate && open;
  const [showCommander, setShowCommander] = useState(false);
  const [allAlerts, setAllAlerts] = useState(false);
  const alerts = allAlerts ? detail.linkedAlerts : detail.linkedAlerts.slice(0, ALERTS_COLLAPSED);

  return (
    <aside aria-label="Incident details" className="min-h-0 space-y-3 lg:overflow-y-auto lg:pr-1">
      <Section title="Owner" tipLabel="About the owner" tip="The person responsible for this incident. Acknowledging tells the team you're on it.">
        <IncidentAssigneePicker
          incidentId={incident.id}
          assigneeUserId={incident.assigneeUserId}
          assigneeName={incident.assigneeName}
          assigneeImage={incident.assigneeImage}
          label="Owner"
          hideLabel
          canUpdate={editable}
        />
        {incident.acknowledgedAt && (
          <p className="text-xs text-muted-foreground" suppressHydrationWarning>
            Acknowledged {formatAgo(incident.acknowledgedAt)}
          </p>
        )}
        {incident.commanderUserId || showCommander ? (
          <IncidentAssigneePicker
            incidentId={incident.id}
            assigneeUserId={incident.commanderUserId}
            assigneeName={incident.commanderName}
            assigneeImage={incident.commanderImage}
            role="commander"
            label="Commander"
            canUpdate={editable}
          />
        ) : editable ? (
          <span className="flex items-center gap-1.5 text-sm">
            <button
              type="button"
              onClick={() => setShowCommander(true)}
              className="rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              + Add commander
            </button>
            <InfoTip label="About the commander">Optional. Coordinates a large incident; the owner does the work.</InfoTip>
          </span>
        ) : null}
        <dl>
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
      </Section>

      <Section title="Status page" tipLabel="About the status page" tip="What customers see. Internal updates stay private unless you post them on the status page.">
        <div className="flex items-center justify-between gap-2 text-sm">
          {detail.publicIncident ? (
            <>
              <span>Public: <span className="capitalize">{detail.publicIncident.status.replace(/_/g, " ")}</span></span>
              <Link className="underline underline-offset-4" href={`/status-pages/${detail.publicIncident.statusPageId}/public/incidents/${detail.publicIncident.id}`}>
                View
              </Link>
            </>
          ) : (
            <span className="text-muted-foreground">Not published</span>
          )}
          {canUpdate && (
            <Link className="underline underline-offset-4" href={detail.publicIncident ? `/status-pages/${detail.publicIncident.statusPageId}` : "/status-pages"}>
              Post update
            </Link>
          )}
        </div>
      </Section>

      <Section title="Alerts" aside={detail.linkedAlerts.length} tipLabel="About alerts" tip="Failed or recovered checks grouped into this incident.">
        {detail.linkedAlerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alerts linked.</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {alerts.map((alert) => (
                <li key={alert.id} className="flex items-start justify-between gap-2 text-sm">
                  <span className="min-w-0 break-words">{alert.title}</span>
                  <TableBadge compact tone={alert.status === "firing" ? "danger" : alert.status === "resolved" ? "success" : "neutral"}><span className="capitalize">{alert.status}</span></TableBadge>
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
      </Section>

      <SimilarIncidentsCard incidentId={incident.id} />

      <dl className="space-y-1.5 border-t pt-3">
        <Row label="Started">{formatDate(incident.createdAt)}</Row>
        <Row label="Acknowledged">
          {incident.acknowledgedAt ? `${formatDate(incident.acknowledgedAt)}${incident.acknowledgedByName ? ` by ${incident.acknowledgedByName}` : ""}` : "Not yet"}
        </Row>
        <Row label="MTTA" tip={<InfoTip label="About MTTA">Mean time to acknowledge: from opened to first acknowledgement.</InfoTip>}>
          {formatDuration(incident.createdAt, incident.acknowledgedAt)}
        </Row>
        {incident.resolvedAt && (
          <Row label="MTTR" tip={<InfoTip label="About MTTR">Mean time to resolve: from opened to resolved.</InfoTip>}>
            {formatDuration(incident.createdAt, incident.resolvedAt)}
          </Row>
        )}
      </dl>
    </aside>
  );
}
