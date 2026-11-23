import { Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";
import { type PaletteTone } from "./palette";
import { BaseLayout, EmailButton, StatusBadge, SubscriberFooter } from "./base-layout";
import {
  getTranslations,
  translateIncidentStatus,
  translateIncidentImpact,
  type TranslationKeys,
} from "../lib/status-page-translations";
import {
  getStatusPageSupportContact,
  getStatusPageSupportCtaLabel,
} from "../lib/status-page-support";

interface IncidentNotificationEmailProps {
  /** The status page\'s email logo (absolute URL); the header shows only the page name without it. */
  logoUrl?: string;
  statusPageName: string;
  statusPageUrl: string;
  /** Public page for this incident: the main button. Falls back to the status page. */
  incidentUrl?: string;
  incidentName: string;
  incidentStatus: string;
  incidentImpact: string;
  incidentDescription: string;
  affectedComponents: string[];
  updateTimestamp: string;
  /** Scheduled maintenance: the window, already formatted in the page's time zone. */
  scheduledWindow?: string;
  unsubscribeUrl?: string;
  supportUrl?: string | null;
  language?: string;
}

/** Badge tone: resolved is always success; otherwise it follows the impact level. */
const getIncidentTone = (status: string, impact: string): PaletteTone => {
  if (status.toLowerCase() === "resolved") return "success";
  if (status.toLowerCase() === "scheduled") return "info";
  switch (impact.toLowerCase()) {
    case "critical":
      return "failure";
    case "major":
    case "minor":
      return "warning";
    default:
      return "neutral";
  }
};

const getStatusLabel = (status: string, t: TranslationKeys): string =>
  translateIncidentStatus(status.toLowerCase(), t);

const getImpactLabel = (impact: string, t: TranslationKeys): string =>
  translateIncidentImpact(impact.toLowerCase(), t);

const introFor = (status: string, t: TranslationKeys) => {
  switch (status.toLowerCase()) {
    case "resolved":
      return t.emailIncidentResolvedIntro;
    case "scheduled":
      return t.emailIncidentScheduledIntro;
    default:
      return t.emailIncidentReportedIntro;
  }
};

export const IncidentNotificationEmail = ({
  logoUrl,
  statusPageName = "Status Page",
  statusPageUrl = "https://status.example.com",
  incidentUrl,
  incidentName = "Service Incident",
  incidentStatus = "investigating",
  incidentImpact = "major",
  incidentDescription = "We are currently investigating this incident.",
  affectedComponents = [],
  updateTimestamp = "",
  scheduledWindow,
  unsubscribeUrl,
  supportUrl,
  language = "en",
}: IncidentNotificationEmailProps) => {
  const t = getTranslations(language);
  const tone = getIncidentTone(incidentStatus, incidentImpact);
  const statusLabel = getStatusLabel(incidentStatus, t);
  const impactLabel = getImpactLabel(incidentImpact, t);
  const supportContact = getStatusPageSupportContact(supportUrl);
  const supportCtaLabel = getStatusPageSupportCtaLabel(language);

  return (
    <BaseLayout
      preview={`${incidentName}: ${statusLabel}${scheduledWindow ? ` (${scheduledWindow})` : ""}`}
      title={statusPageName}
      lang={language}
      showBrand={false}
      headerLogoUrl={logoUrl}
      showStandardFooter={false}
      footer={
        <SubscriberFooter
          notice={`${t.emailSubscriptionNotice} ${statusPageName}.`}
          links={[
            { href: statusPageUrl, label: t.emailViewStatusPage },
            { href: unsubscribeUrl, label: t.unsubscribe },
          ]}
          poweredBy={t.poweredBy}
        />
      }
    >
      <Section style={badgeContainer}>
        <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
      </Section>

      <Section style={contentSection}>
        <Heading as="h2" style={incidentTitle}>
          {incidentName}
        </Heading>
        <Text style={introText}>{introFor(incidentStatus, t)}</Text>
      </Section>

      <Section style={contentSection}>
        <table style={infoBox} cellPadding="0" cellSpacing="0">
          <tbody>
            <tr>
              <td style={{ padding: "16px 20px" }}>
                <table cellPadding="0" cellSpacing="0" style={{ width: "100%" }}>
                  <tbody>
                    <tr>
                      <td style={{ width: "50%", verticalAlign: "top" }}>
                        <Text style={infoLabel}>{t.status}</Text>
                        <Text style={infoValue}>{statusLabel}</Text>
                      </td>
                      <td style={{ width: "50%", verticalAlign: "top" }}>
                        <Text style={infoLabel}>{t.impact}</Text>
                        <Text style={infoValue}>{impactLabel}</Text>
                      </td>
                    </tr>
                    {scheduledWindow && (
                      <tr>
                        <td colSpan={2} style={{ paddingTop: "16px", verticalAlign: "top" }}>
                          <Text style={infoLabel}>{t.scheduled}</Text>
                          <Text style={infoValue}>{scheduledWindow}</Text>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section style={contentSection}>
        <Text style={sectionLabel}>{t.emailUpdate}</Text>
        <Text style={descriptionText}>{incidentDescription}</Text>
        {updateTimestamp && (
          <Text style={timestampText}>
            {t.emailPosted}: {updateTimestamp}
          </Text>
        )}
      </Section>

      {affectedComponents.length > 0 && (
        <Section style={contentSection}>
          <Text style={sectionLabel}>{t.emailAffectedServices}</Text>
          <Text style={descriptionText}>{affectedComponents.join(", ")}</Text>
        </Section>
      )}

      <Section style={buttonSection}>
        <EmailButton href={incidentUrl || statusPageUrl}>
          {incidentUrl ? t.emailViewIncident : t.emailViewStatusPage}
        </EmailButton>
        {supportContact && (
          <Text style={supportText}>
            <Link href={supportContact.href} style={supportLink}>
              {supportCtaLabel}
            </Link>
          </Text>
        )}
      </Section>
    </BaseLayout>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const badgeContainer = {
  padding: "24px 32px 0",
};

const contentSection = {
  padding: "0 32px",
};

const incidentTitle = {
  color: "#111827",
  fontSize: "22px",
  fontWeight: "700" as const,
  margin: "20px 0 16px",
  lineHeight: "1.3",
  letterSpacing: "-0.02em",
};

const introText = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.65",
  margin: "0 0 24px",
  textAlign: "left" as const,
};

const infoBox = {
  width: "100%",
  backgroundColor: "#f9fafb",
  borderRadius: "8px",
  marginBottom: "24px",
};

const infoLabel = {
  color: "#6b7280",
  fontSize: "11px",
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  margin: "0 0 4px",
};

const infoValue = {
  color: "#111827",
  fontSize: "16px",
  fontWeight: "600" as const,
  margin: "0",
};

const sectionLabel = {
  color: "#6b7280",
  fontSize: "11px",
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  margin: "0 0 8px",
};

const descriptionText = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.65",
  margin: "0 0 8px",
};

const timestampText = {
  color: "#6b7280",
  fontSize: "13px",
  margin: "0 0 24px",
};

const supportText = {
  color: "#4b5563",
  fontSize: "14px",
  margin: "16px 0 0",
};

const supportLink = {
  color: "#1d4ed8",
  textDecoration: "underline",
};

const buttonSection = {
  textAlign: "center" as const,
  padding: "16px 32px 32px",
};

export default IncidentNotificationEmail;
