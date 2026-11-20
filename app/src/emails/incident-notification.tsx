import {
  Button,
  Heading,
  Hr,
  Link,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { type PaletteTone } from "./palette";
import { BaseLayout, EmailButton, StatusBadge } from "./base-layout";
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
  statusPageName: string;
  statusPageUrl: string;
  incidentName: string;
  incidentStatus: string;
  incidentImpact: string;
  incidentDescription: string;
  affectedComponents: string[];
  updateTimestamp: string;
  unsubscribeUrl?: string;
  supportUrl?: string | null;
  language?: string;
}

/** Badge tone: resolved is always success; otherwise it follows the impact level. */
const getIncidentTone = (status: string, impact: string): PaletteTone => {
  if (status.toLowerCase() === "resolved") return "success";
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

/**
 * Get status display label (translated)
 */
const getStatusLabel = (status: string, t: TranslationKeys): string => {
  return translateIncidentStatus(status.toLowerCase(), t);
};

/**
 * Get impact display label (translated)
 */
const getImpactLabel = (impact: string, t: TranslationKeys): string => {
  return translateIncidentImpact(impact.toLowerCase(), t);
};

export const IncidentNotificationEmail = ({
  statusPageName = "Status Page",
  statusPageUrl = "https://status.example.com",
  incidentName = "Service Incident",
  incidentStatus = "investigating",
  incidentImpact = "major",
  incidentDescription = "We are currently investigating this incident.",
  affectedComponents = [],
  updateTimestamp = new Date().toLocaleString(),
  unsubscribeUrl,
  supportUrl,
  language = "en",
}: IncidentNotificationEmailProps) => {
  const t = getTranslations(language);
  const tone = getIncidentTone(incidentStatus, incidentImpact);
  const statusLabel = getStatusLabel(incidentStatus, t);
  const impactLabel = getImpactLabel(incidentImpact, t);
  const isResolved = incidentStatus.toLowerCase() === "resolved";
  const supportContact = getStatusPageSupportContact(supportUrl);
  const supportCtaLabel = getStatusPageSupportCtaLabel(language);

  return (
    <BaseLayout
      preview={isResolved ? `✓ ${statusLabel}` : `⚠ ${impactLabel}`}
      title={statusPageName}
      lang={language}
      showBrand={false}
      showStandardFooter={false}
      footer={
        <>
            <Text style={footerText}>
              {t.emailSubscriptionNotice} {statusPageName}.
            </Text>
            <Text style={footerLinks}>
              <Link href={statusPageUrl} style={footerLink}>
                {t.emailViewStatusPage}
              </Link>
              {unsubscribeUrl && (
                <>
                  {" • "}
                  <Link href={unsubscribeUrl} style={footerLink}>
                    {t.unsubscribe}
                  </Link>
                </>
              )}
            </Text>
            <Text style={copyright}>
              {t.poweredBy}{" "}
              <Link href="https://supercheck.io" style={footerLink}>
                Supercheck
              </Link>
            </Text>
          </>
      }
    >

          {/* Status Badge */}
          <Section style={badgeContainer}>
            <StatusBadge tone={tone}>
              {isResolved ? "\u2713 " : ""}
              {statusLabel}
            </StatusBadge>
          </Section>

          {/* Incident Title */}
          <Section style={contentSection}>
            <Heading as="h2" style={incidentTitle}>
              {incidentName}
            </Heading>
          </Section>

          {/* Introduction Text */}
          <Section style={contentSection}>
            <Text style={introText}>
              {isResolved
                ? `${t.emailIncidentResolvedIntro}`
                : `${t.emailIncidentReportedIntro}`}
            </Text>
          </Section>

          {/* Status & Impact Info Box - Border Left Style */}
          <Section style={contentSection}>
            <table
              style={{
                ...infoBox,
                borderLeft: "4px solid #d1d5db",
              }}
              cellPadding="0"
              cellSpacing="0"
            >
              <tbody>
                <tr>
                  <td style={{ padding: "16px 20px" }}>
                    <table
                      cellPadding="0"
                      cellSpacing="0"
                      style={{ width: "100%" }}
                    >
                      <tbody>
                        <tr>
                          <td style={{ width: "50%", verticalAlign: "top" }}>
                            <Text style={{ ...infoLabel }}>{t.status}</Text>
                            <Text
                              style={infoValue}
                            >
                              {statusLabel}
                            </Text>
                          </td>
                          <td style={{ width: "50%", verticalAlign: "top" }}>
                            <Text style={{ ...infoLabel }}>{t.impact}</Text>
                            <Text
                              style={infoValue}
                            >
                              {impactLabel}
                            </Text>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          {/* Description */}
          <Section style={contentSection}>
            <Text style={sectionLabel}>{t.emailUpdate}</Text>
            <Text style={descriptionText}>{incidentDescription}</Text>
            <Text style={timestampText}>{t.emailPosted}: {updateTimestamp}</Text>
          </Section>

          {/* Affected Components */}
          {affectedComponents.length > 0 && (
            <Section style={contentSection}>
              <table style={componentsBox} cellPadding="0" cellSpacing="0">
                <tbody>
                  <tr>
                    <td style={{ padding: "16px 20px" }}>
                      <Text style={componentsTitle}>{t.emailAffectedServices}</Text>
                      {affectedComponents.map((component, index) => (
                        <Text key={index} style={componentItem}>
                          • {component}
                        </Text>
                      ))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>
          )}

          {/* CTA Button */}
          <Section style={buttonSection}>
            <EmailButton href={statusPageUrl}>{t.emailViewStatusPage}</EmailButton>
            {supportContact && (
              <>
                <div style={buttonSpacer} />
                <Button style={secondaryButton} href={supportContact.href}>
                  {supportCtaLabel}
                </Button>
              </>
            )}
          </Section>

          <Hr style={divider} />

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
  color: "#9ca3af",
  fontSize: "13px",
  margin: "0 0 24px",
};

const componentsBox = {
  width: "100%",
  backgroundColor: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  marginBottom: "24px",
};

const componentsTitle = {
  color: "#4b5563",
  fontSize: "12px",
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  margin: "0 0 12px",
};

const componentItem = {
  color: "#4b5563",
  fontSize: "14px",
  margin: "0 0 4px",
  lineHeight: "1.5",
};

const buttonSection = {
  textAlign: "center" as const,
  padding: "8px 32px 32px",
};

const buttonSpacer = {
  height: "12px",
};

const secondaryButton = {
  backgroundColor: "#ffffff",
  borderRadius: "6px",
  color: "#111827",
  fontSize: "15px",
  fontWeight: "600" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 28px",
  border: "1px solid #d1d5db",
};

const divider = {
  borderColor: "#e5e7eb",
  margin: "0",
};


const footerText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 12px",
  textAlign: "center" as const,
};

const footerLinks = {
  color: "#6b7280",
  fontSize: "13px",
  margin: "0 0 12px",
  textAlign: "center" as const,
};

const footerLink = {
  color: "#4b5563",
  textDecoration: "underline",
};

const copyright = {
  color: "#9ca3af",
  fontSize: "12px",
  margin: "0",
  textAlign: "center" as const,
};

export default IncidentNotificationEmail;
