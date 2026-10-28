import { Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout, DetailsTable, EmailButton, type DetailField } from "./base-layout";

interface MonitorAlertEmailProps {
  title: string;
  message: string;
  fields: DetailField[];
  footer: string;
  type: "failure" | "success" | "warning";
  color?: string;
  /** Absolute link to the incidents page; when set, failure/warning emails get a "View incidents" button. */
  incidentsUrl?: string;
}

/** Header colours: dark enough for white text, shared with the incident emails. */
const HEADER_TITLE = {
  failure: "Alert",
  success: "Recovered",
  warning: "Warning",
} as const;

const HEADER_COLOR = {
  failure: "#b91c1c",
  success: "#15803d",
  warning: "#b45309",
} as const;

/**
 * Accent colour for the message border (the channels' alert palette)
 */
const getStatusColor = (type: string): string => {
  switch (type) {
    case "failure":
      return "#ef4444"; // Red-500
    case "success":
      return "#22c55e"; // Green-500
    case "warning":
      return "#f59e0b"; // Amber-500
    default:
      return "#3b82f6"; // Blue-500
  }
};

export const MonitorAlertEmail = ({
  title = "Monitor Alert",
  message = "Your monitor has detected an issue",
  fields = [
    { title: "Monitor", value: "Example Monitor" },
    { title: "Status", value: "Failed" },
    { title: "Dashboard Link", value: "https://supercheck.io/dashboard" },
  ],
  footer = "Supercheck Monitoring System",
  type = "failure",
  color,
  incidentsUrl,
}: MonitorAlertEmailProps) => {
  const statusColor = color ?? getStatusColor(type);
  const headerColor = HEADER_COLOR[type] ?? "#1f2937";

  return (
    <BaseLayout
      preview={title}
      title={HEADER_TITLE[type] ?? "Alert"}
      headerColor={headerColor}
      // We use the standard footer from BaseLayout, but append the custom footer text if needed
      // or just rely on the standard one. The prompt asked for a proper footer consistent across all templates.
      // The BaseLayout now has a standard footer. We can pass this custom footer as null to use the default,
      // or pass it if it contains specific info.
      // Let's pass the custom footer text as a simple text block above the standard footer links if it's unique.
      footer={
        footer && 
        footer !== "Supercheck Monitoring System" && 
        footer !== "Supercheck Job Monitoring" ? (
          <Text style={customFooterText}>{footer}</Text>
        ) : undefined
      }
    >
      {/* Alert Title */}
      <Section style={titleSection}>
        {type === "success" && <Text style={resolvedChip}>&#10003; Resolved</Text>}
        <Text style={alertTitle}>{title}</Text>
      </Section>

      {/* Alert Message */}
      <Section style={{ ...messageBox, borderLeftColor: statusColor }}>
        <Text style={messageText}>{message}</Text>
      </Section>

      <DetailsTable heading="Alert details" fields={fields} />

      {/* Incident follow-up (failure/warning only) */}
      {type !== "success" && incidentsUrl && (
        <Section style={incidentSection}>
          <Text style={incidentText}>
            Ongoing failures are tracked as incidents. Review status, owner and
            investigation findings in Supercheck.
          </Text>
          <EmailButton href={incidentsUrl}>View incidents</EmailButton>
        </Section>
      )}
    </BaseLayout>
  );
};

const resolvedChip = {
  display: "inline-block",
  margin: "0 0 12px",
  padding: "2px 10px",
  borderRadius: "999px",
  backgroundColor: "#dcfce7",
  color: "#166534",
  fontSize: "12px",
  fontWeight: "700" as const,
  letterSpacing: "0.04em",
  textTransform: "uppercase" as const,
};

const incidentSection = {
  padding: "0 32px 32px",
  textAlign: "center" as const,
};

const incidentText = {
  margin: "0 0 16px",
  color: "#4b5563",
  fontSize: "14px",
  lineHeight: "1.6",
};

const titleSection = {
  padding: "32px 32px 0",
};

const alertTitle = {
  color: "#111827",
  fontSize: "20px",
  fontWeight: "700" as const,
  margin: "0 0 24px",
  lineHeight: "1.4",
  textAlign: "left" as const,
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







const customFooterText = {
  color: "#6b7280",
  fontSize: "13px",
  margin: "0 0 16px",
};

export default MonitorAlertEmail;
