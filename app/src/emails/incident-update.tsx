import { Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout, EmailButton } from "./base-layout";

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
  actorName?: string;
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

const HEADER_COLOR: Record<IncidentUpdateEvent, string> = {
  created: "#b91c1c",
  reopened: "#b91c1c",
  assigned: "#1d4ed8",
  acknowledged: "#1d4ed8",
  ai_finding: "#6d28d9",
  resolved: "#15803d",
  recovered: "#15803d",
};

export function incidentUpdateHeadline(
  event: IncidentUpdateEvent,
  actorName?: string,
): string {
  const by = actorName ? ` by ${actorName}` : "";
  switch (event) {
    case "created":
      return "A new incident was opened";
    case "assigned":
      return actorName
        ? `Incident assigned to ${actorName}`
        : "Incident was assigned";
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
}: IncidentUpdateEmailProps) => {
  const sev = SEVERITY[severity] ?? SEVERITY.sev3;
  const headline = incidentUpdateHeadline(event, actorName);

  return (
    <BaseLayout
      preview={`${headline}: #${incidentNumber} ${title}`}
      title={`Incident #${incidentNumber}`}
      headerColor={HEADER_COLOR[event] ?? "#1f2937"}
    >
      <Section style={section}>
        <Text style={headlineStyle}>{headline}</Text>
        <Text style={titleStyle}>{title}</Text>
        <Text style={metaRow}>
          <span
            style={{ ...chip, backgroundColor: sev.bg, color: sev.fg }}
          >
            {sev.label}
          </span>
          <span style={{ ...chip, backgroundColor: "#f3f4f6", color: "#374151" }}>
            {statusLabel}
          </span>
          {serviceName ? (
            <span style={{ ...chip, backgroundColor: "#f3f4f6", color: "#374151" }}>
              {serviceName}
            </span>
          ) : null}
        </Text>
      </Section>

      {detail ? (
        <Section style={section}>
          <Text style={detailBox}>{detail}</Text>
        </Section>
      ) : null}

      <Section style={buttonSection}>
        <EmailButton href={incidentUrl}>
          {`Open incident #${incidentNumber}`}
        </EmailButton>
      </Section>
    </BaseLayout>
  );
};

const section = { padding: "28px 32px 0" };

const headlineStyle = {
  margin: "0 0 8px",
  color: "#6b7280",
  fontSize: "13px",
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

const titleStyle = {
  margin: "0 0 16px",
  color: "#111827",
  fontSize: "20px",
  fontWeight: "700" as const,
  lineHeight: "1.4",
};

const metaRow = { margin: "0", lineHeight: "2" };

const chip = {
  display: "inline-block",
  marginRight: "8px",
  padding: "2px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: "600" as const,
};

const detailBox = {
  margin: "0",
  padding: "16px 20px",
  backgroundColor: "#f9fafb",
  borderLeft: "4px solid #d1d5db",
  color: "#374151",
  fontSize: "14px",
  lineHeight: "1.6",
  whiteSpace: "pre-wrap" as const,
};

const buttonSection = {
  padding: "28px 32px 32px",
  textAlign: "center" as const,
};

export default IncidentUpdateEmail;
