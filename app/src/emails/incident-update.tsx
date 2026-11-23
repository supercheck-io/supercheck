import { Section, Text } from "@react-email/components";
import * as React from "react";
import { PALETTE, type PaletteTone } from "./palette";
import { BaseLayout, DetailsTable, EmailButton, formatEmailTime, StatusBadge, type DetailField } from "./base-layout";

export type IncidentUpdateEvent =
  | "created"
  | "assigned"
  | "acknowledged"
  | "ai_finding"
  | "resolved"
  | "recovered"
  | "reopened"
  | "commented"
  | "severity_changed"
  | "unacknowledged"
  | "escalated";

export type IncidentUpdateSeverity = "sev1" | "sev2" | "sev3" | "sev4";

export interface IncidentUpdateEmailProps {
  event: IncidentUpdateEvent;
  incidentNumber: number;
  title: string;
  severity: IncidentUpdateSeverity;
  statusLabel: string;
  serviceName?: string;
  /** Plain text (rendered escaped). */
  detail?: string;
  incidentUrl: string;
  /** Person who caused the event (acknowledged, resolved, reopened). */
  actorName?: string;
  /** Current owner of the incident. */
  assigneeName?: string;
  /** When the event happened; defaults to now. */
  occurredAt?: Date;
}

const SEVERITY: Record<IncidentUpdateSeverity, { label: string; tone: PaletteTone }> = {
  sev1: { label: "SEV1 Critical", tone: "failure" },
  sev2: { label: "SEV2 High", tone: "warning" },
  sev3: { label: "SEV3 Medium", tone: "warning" },
  sev4: { label: "SEV4 Low", tone: "neutral" },
};

/** Accent for chat/webhook notifications (Slack, Teams...); emails never use it for the header. */
export const INCIDENT_EVENT_COLOR: Record<IncidentUpdateEvent, string> = {
  created: PALETTE.failure,
  reopened: PALETTE.failure,
  assigned: PALETTE.info,
  acknowledged: PALETTE.info,
  ai_finding: PALETTE.info,
  resolved: PALETTE.success,
  recovered: PALETTE.success,
  commented: PALETTE.info,
  severity_changed: PALETTE.warning,
  unacknowledged: PALETTE.failure,
  escalated: PALETTE.failure,
};

export function incidentSeverityLabel(severity: string): string {
  return SEVERITY[severity as IncidentUpdateSeverity]?.label ?? severity.toUpperCase();
}

export function incidentUpdateHeadline(
  event: IncidentUpdateEvent,
  actorName?: string,
  assigneeName?: string,
): string {
  const by = actorName ? ` by ${actorName}` : "";
  switch (event) {
    case "created":
      return "New incident opened";
    case "assigned":
      return assigneeName
        ? `Incident assigned to ${assigneeName}`
        : "Incident assigned";
    case "acknowledged":
      return `Incident acknowledged${by}`;
    case "ai_finding":
      return "AI investigation has a new finding";
    case "resolved":
      return `Incident resolved${by}`;
    case "recovered":
      return "Monitoring recovered; the incident can be closed";
    case "reopened":
      return `Incident reopened${by}`;
    case "commented":
      return `New note${by}`;
    case "severity_changed":
      return `Severity changed${by}`;
    case "unacknowledged":
      return "Incident still needs acknowledging";
    case "escalated":
      return "Incident escalated: still unacknowledged";
  }
}

const SUBJECT_MAX = 70;

/**
 * `[SEV2] #15 Checkout API is failing: New incident opened`. Severity and number lead so the inbox sorts and
 * scans by them; the title is cut (with an ellipsis) so the whole subject stays within ~70 characters.
 */
export function incidentUpdateSubject(
  props: Pick<IncidentUpdateEmailProps, "event" | "incidentNumber" | "title" | "severity" | "actorName" | "assigneeName">,
): string {
  const prefix = `[${String(props.severity).toUpperCase()}] #${props.incidentNumber} `;
  const suffix = `: ${incidentUpdateHeadline(props.event, props.actorName, props.assigneeName)}`;
  const room = Math.max(12, SUBJECT_MAX - prefix.length - suffix.length);
  const title = props.title.replace(/\s+/g, " ").trim();
  return `${prefix}${title.length > room ? `${title.slice(0, room - 1).trimEnd()}…` : title}${suffix}`;
}

/** One-line explanation shown under the title when there is no event detail. */
export const INCIDENT_EVENT_MESSAGE: Record<IncidentUpdateEvent, string> = {
  created: "Supercheck opened an incident. Review the evidence, assign an owner and start the investigation.",
  assigned: "The incident has a new owner.",
  acknowledged: "Someone is working on this incident.",
  ai_finding: "The AI investigation added a finding. Review its evidence before acting on it.",
  resolved: "This incident is resolved. Reopen it if the problem comes back.",
  recovered: "The checks that raised this incident are passing again. Resolve the incident once you have confirmed the fix.",
  reopened: "This incident was reopened and needs attention again.",
  commented: "A note was added to this incident.",
  severity_changed: "The severity of this incident changed.",
  unacknowledged: "Nobody has acknowledged this incident yet. Acknowledge it so the team knows someone is on it.",
  escalated: "Nobody acknowledged this incident in time, so it was escalated to you. Acknowledge it so the team knows someone is on it.",
};

export function incidentUpdateFields(
  props: Pick<
    IncidentUpdateEmailProps,
    "incidentNumber" | "severity" | "statusLabel" | "serviceName" | "assigneeName" | "actorName" | "occurredAt"
  >,
): DetailField[] {
  const fields: DetailField[] = [
    { title: "Incident", value: `#${props.incidentNumber}` },
    { title: "Severity", value: incidentSeverityLabel(props.severity) },
    { title: "Status", value: props.statusLabel },
  ];
  if (props.serviceName) fields.push({ title: "Service", value: props.serviceName });
  fields.push({ title: "Owner", value: props.assigneeName || "Unassigned" });
  if (props.actorName) fields.push({ title: "Updated by", value: props.actorName });
  fields.push({ title: "Time", value: formatEmailTime(props.occurredAt ?? new Date()) });
  return fields;
}

/** Notification settings live on the same origin as the incident link. */
function notificationsLink(incidentUrl: string) {
  try {
    const url = new URL(incidentUrl);
    if (!/^https?:$/.test(url.protocol)) return undefined;
    return { href: `${url.origin}/notifications`, label: "Manage notifications" };
  } catch {
    return undefined;
  }
}

export const IncidentUpdateEmail = ({
  event = "created",
  incidentNumber = 1,
  title = "Checkout API is failing",
  severity = "sev2",
  statusLabel = "Open",
  serviceName,
  detail,
  incidentUrl = "https://app.supercheck.io/incidents",
  actorName,
  assigneeName,
  occurredAt,
}: IncidentUpdateEmailProps) => {
  const sev = SEVERITY[severity] ?? SEVERITY.sev3;
  const headline = incidentUpdateHeadline(event, actorName, assigneeName);

  return (
    <BaseLayout
      preview={`#${incidentNumber} ${title}: ${detail || INCIDENT_EVENT_MESSAGE[event]}`}
      title={headline}
      reason="You received this because you are an owner, participant or notification recipient for this incident."
      manage={notificationsLink(incidentUrl)}
    >
      <Section style={titleSection}>
        <Text style={metaRow}>
          <StatusBadge tone={sev.tone}>{sev.label}</StatusBadge>{" "}
          <StatusBadge>{statusLabel}</StatusBadge>
        </Text>
        <Text style={titleStyle}>
          #{incidentNumber} {title}
        </Text>
      </Section>

      <Section style={messageBox}>
        <Text style={messageText}>{detail || INCIDENT_EVENT_MESSAGE[event]}</Text>
      </Section>

      <DetailsTable
        heading="Incident details"
        fields={incidentUpdateFields({
          incidentNumber,
          severity,
          statusLabel,
          serviceName,
          assigneeName,
          actorName,
          occurredAt,
        })}
      />

      <Section style={buttonSection}>
        <EmailButton href={incidentUrl}>
          {`Open incident #${incidentNumber}`}
        </EmailButton>
      </Section>
    </BaseLayout>
  );
};

const titleSection = { padding: "32px 32px 0" };

const titleStyle = {
  margin: "0 0 24px",
  color: "#111827",
  fontSize: "20px",
  fontWeight: "700" as const,
  lineHeight: "1.4",
};

const metaRow = { margin: "0 0 12px", lineHeight: "2" };

const messageBox = {
  backgroundColor: "#f9fafb",
  borderLeft: "4px solid #d1d5db",
  padding: "16px 24px",
  margin: "0 0 32px",
  borderRadius: "0 4px 4px 0",
};

const messageText = {
  margin: "0",
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.6",
  whiteSpace: "pre-wrap" as const,
};

const buttonSection = {
  padding: "0 32px 32px",
  textAlign: "center" as const,
};

export default IncidentUpdateEmail;
