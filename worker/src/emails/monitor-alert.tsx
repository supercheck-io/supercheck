import { Section, Text } from "@react-email/components";
import * as React from "react";
import { PALETTE } from "./palette";
import { BaseLayout, DetailsTable, EmailButton, type DetailField } from "./base-layout";

interface MonitorAlertEmailProps {
  title: string;
  message: string;
  fields: DetailField[];
  footer: string;
  /** success = a plain pass (e.g. a job run); recovery = back to healthy after a failure. */
  type: "failure" | "success" | "recovery" | "warning" | "info";
  /** @deprecated Ignored: colours come from the shared email palette. */
  color?: string;
  /** Absolute link to the incidents page; when set, failure/warning emails get a "View incidents" button. */
  incidentsUrl?: string;
}

const HEADER_TITLE = {
  failure: "Alert",
  success: "Passed",
  recovery: "Recovered",
  warning: "Warning",
  info: "Notice",
} as const;

const TONE = {
  failure: "failure",
  success: "success",
  recovery: "success",
  warning: "warning",
  info: "info",
} as const;

/** `Job Failed - Nightly` -> `[Supercheck] Job Failed: Nightly`. */
export const alertEmailSubject = (title: string): string => {
  const i = title.indexOf(" - ");
  return `[Supercheck] ${i > 0 ? `${title.slice(0, i)}: ${title.slice(i + 3)}` : title}`;
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
  incidentsUrl,
}: MonitorAlertEmailProps) => {
  const headerColor = PALETTE[TONE[type] ?? "neutral"];

  return (
    <BaseLayout
      preview={title}
      title={HEADER_TITLE[type] ?? "Alert"}
      headerColor={headerColor}
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
        {type === "recovery" && <Text style={resolvedChip}>&#10003; Resolved</Text>}
        <Text style={alertTitle}>{title}</Text>
      </Section>

      {/* Alert Message */}
      <Section style={{ ...messageBox, borderLeftColor: headerColor }}>
        <Text style={messageText}>{message}</Text>
      </Section>

      <DetailsTable heading="Alert details" fields={fields} />

      {/* Incident follow-up (failure/warning only) */}
      {(type === "failure" || type === "warning") && incidentsUrl && (
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
  color: PALETTE.success,
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
