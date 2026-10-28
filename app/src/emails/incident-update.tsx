import { Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout, DetailsTable, EmailButton, type DetailField } from "./base-layout";

export type IncidentUpdateEvent =
  | "created"
  | "assigned"
  | "acknowledged"
  | "ai_finding"
  | "resolved"
  | "recovered"
  | "reopened";

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

const SEVERITY: Record<
  IncidentUpdateSeverity,
  { label: string; bg: string; fg: string }
> = {
  sev1: { label: "SEV1 Critical", bg: "#b91c1c", fg: "#ffffff" },
  sev2: { label: "SEV2 High", bg: "#c2410c", fg: "#ffffff" },
  sev3: { label: "SEV3 Medium", bg: "#fde68a", fg: "#78350f" },
  sev4: { label: "SEV4 Low", bg: "#e5e7eb", fg: "#374151" },
};

/** Same palette as the monitor alert email: red open, amber/blue in progress, green closed. */
export const INCIDENT_EVENT_COLOR: Record<IncidentUpdateEvent, string> = {
  created: "#b91c1c",
  reopened: "#b91c1c",
  assigned: "#1d4ed8",
  acknowledged: "#1d4ed8",
  ai_finding: "#6d28d9",
  resolved: "#15803d",
  recovered: "#15803d",
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
  }
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
  fields.push({ title: "Time", value: (props.occurredAt ?? new Date()).toUTCString() });
  return fields;
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
  const accent = INCIDENT_EVENT_COLOR[event] ?? "#1f2937";

  return (
    <BaseLayout
      preview={`${headline}: #${incidentNumber} ${title}`}
      title={headline}
      headerColor={accent}
    >
      <Section style={titleSection}>
        <Text style={metaRow}>
          <span style={{ ...chip, backgroundColor: sev.bg, color: sev.fg }}>
            {sev.label}
          </span>
          <span style={{ ...chip, backgroundColor: "#f3f4f6", color: "#374151" }}>
            {statusLabel}
          </span>
        </Text>
        <Text style={titleStyle}>
          #{incidentNumber} {title}
        </Text>
      </Section>

      <Section style={{ ...messageBox, borderLeftColor: accent }}>
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

const chip = {
  display: "inline-block",
  marginRight: "8px",
  padding: "2px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: "600" as const,
};

const messageBox = {
  backgroundColor: "#f9fafb",
  borderLeft: "4px solid",
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
