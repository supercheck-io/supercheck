import { Link, Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout, DetailsTable, EmailButton, StatusBadge, type DetailField } from "./base-layout";

interface MonitorAlertEmailProps {
  title: string;
  message: string;
  fields: DetailField[];
  footer: string;
  /** success = a plain pass (e.g. a job run); recovery = back to healthy after a failure. */
  type: "failure" | "success" | "recovery" | "warning" | "info";
  /** @deprecated Ignored: every email uses the same neutral header. */
  color?: string;
  /** Absolute link to the incidents page; failure/warning emails link to it under the main button. */
  incidentsUrl?: string;
  /** Absolute link to the monitor or run this alert is about: the email's main button. */
  resourceUrl?: string;
  /** Button text for resourceUrl, for example "Open monitor" or "Open run". */
  resourceLabel?: string;
  /** Absolute link to the notification channel settings, shown in the footer. */
  manageUrl?: string;
  /** Public app origin, for the header logo. */
  appUrl?: string;
}

const HEADER_TITLE = {
  failure: "Alert",
  success: "Passed",
  recovery: "Recovered",
  warning: "Warning",
  info: "Notice",
} as const;

const BADGE_LABEL = {
  failure: "Failing",
  success: "Passed",
  recovery: "\u2713 Resolved",
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

/**
 * Inbox preview (preheader): the alert message on one line, cut to ~120 characters. Without it Gmail previews the
 * body text, which runs the details table together ("ProjectDefault ProjectJob..."). Falls back to the title.
 */
export const alertEmailPreview = (message: string, title: string): string => {
  const text = message.replace(/\s+/g, " ").trim();
  if (!text) return title;
  return text.length > 120 ? `${text.slice(0, 119).trimEnd()}…` : text;
};

/** Sentence case for the event words only: "SSL Certificate Renewed" -> "SSL certificate renewed" (acronyms stay). */
const sentenceCaseEvent = (event: string) => event.replace(/ ([A-Z])([a-z]+)/g, (_m, first: string, rest: string) => ` ${first.toLowerCase()}${rest}`);

/** `Job Failed - Nightly` -> `[Supercheck] Job failed: Nightly`. The name after the dash is kept as written. */
export const alertEmailSubject = (title: string): string => {
  const i = title.indexOf(" - ");
  return `[Supercheck] ${i > 0 ? `${sentenceCaseEvent(title.slice(0, i))}: ${title.slice(i + 3)}` : sentenceCaseEvent(title)}`;
};

export const MonitorAlertEmail = ({
  title = "Monitor Alert",
  message = "Your monitor has detected an issue",
  fields = [
    { title: "Monitor", value: "Example Monitor" },
    { title: "Status", value: "Down" },
  ],
  footer = "Supercheck Monitoring System",
  type = "failure",
  incidentsUrl,
  resourceUrl,
  resourceLabel = "Open in Supercheck",
  manageUrl,
  appUrl,
}: MonitorAlertEmailProps) => {
  const tone = TONE[type] ?? "neutral";
  const showIncidents = (type === "failure" || type === "warning") && Boolean(incidentsUrl);
  // Same "<Event>: <Name>" wording as the subject.
  const displayTitle = alertEmailSubject(title).replace(/^\[Supercheck\] /, "");

  return (
    <BaseLayout
      preview={alertEmailPreview(message, displayTitle)}
      appUrl={appUrl}
      reason="You received this alert because this address is set as a recipient on a Supercheck notification channel."
      manage={manageUrl ? { href: manageUrl, label: "Manage notification channels" } : undefined}
      title={HEADER_TITLE[type] ?? "Alert"}
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
        <Text style={badgeRow}>
          <StatusBadge tone={tone} skipInText>{BADGE_LABEL[type] ?? "Alert"}</StatusBadge>
        </Text>
        <Text style={alertTitle}>{displayTitle}</Text>
      </Section>

      {/* Alert Message */}
      <Section style={messageBox}>
        <Text style={messageText}>{message}</Text>
      </Section>

      <DetailsTable heading="Alert details" fields={fields} />

      {(resourceUrl || showIncidents) && (
        <Section style={actionSection}>
          {resourceUrl && <EmailButton href={resourceUrl}>{resourceLabel}</EmailButton>}
          {showIncidents && (
            <Text style={incidentText}>
              Ongoing failures are tracked as incidents.{" "}
              <Link href={incidentsUrl} style={incidentLink}>
                View incidents
              </Link>
            </Text>
          )}
        </Section>
      )}
    </BaseLayout>
  );
};

const badgeRow = {
  margin: "0 0 12px",
};

const actionSection = {
  padding: "0 32px 32px",
  textAlign: "center" as const,
};

const incidentText = {
  margin: "16px 0 0",
  color: "#4b5563",
  fontSize: "14px",
  lineHeight: "1.6",
};

const incidentLink = {
  color: "#1d4ed8",
  textDecoration: "underline",
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


const customFooterText = {
  color: "#6b7280",
  fontSize: "13px",
  margin: "0 0 16px",
};

export default MonitorAlertEmail;
