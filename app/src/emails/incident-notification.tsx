import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface IncidentNotificationEmailProps {
  statusPageName: string;
  statusPageUrl: string;
  incidentName: string;
  incidentStatus: string;
  incidentImpact: string;
  incidentDescription: string;
  affectedComponents: string[];
  updateTimestamp: string;
  unsubscribeUrl: string;
}

/**
 * Get colors based on incident status and impact
 * When status is "resolved", always show green colors
 * Otherwise, show colors based on impact level
 */
const getIncidentColors = (
  status: string,
  impact: string
): {
  textColor: string;
  headerBg: string;
  badgeBg: string;
  badgeText: string;
  borderColor: string;
} => {
  // Resolved incidents always show green, regardless of impact
  if (status.toLowerCase() === "resolved") {
    return {
      textColor: "#166534",
      headerBg: "#16a34a",
      badgeBg: "#dcfce7",
      badgeText: "#166534",
      borderColor: "#16a34a",
    };
  }

  // For non-resolved incidents, use impact-based colors
  switch (impact.toLowerCase()) {
    case "critical":
      return {
        textColor: "#991b1b",
        headerBg: "#dc2626",
        badgeBg: "#fee2e2",
        badgeText: "#991b1b",
        borderColor: "#dc2626",
      };
    case "major":
      return {
        textColor: "#9a3412",
        headerBg: "#ea580c",
        badgeBg: "#ffedd5",
        badgeText: "#9a3412",
        borderColor: "#ea580c",
      };
    case "minor":
      return {
        textColor: "#854d0e",
        headerBg: "#ca8a04",
        badgeBg: "#fef9c3",
        badgeText: "#854d0e",
        borderColor: "#ca8a04",
      };
    default:
      return {
        textColor: "#374151",
        headerBg: "#6b7280",
        badgeBg: "#f3f4f6",
        badgeText: "#374151",
        borderColor: "#6b7280",
      };
  }
};

/**
 * Get status display label
 */
const getStatusLabel = (status: string): string => {
  const labels: Record<string, string> = {
    investigating: "Investigating",
    identified: "Identified",
    monitoring: "Monitoring",
    resolved: "Resolved",
    scheduled: "Scheduled",
  };
  return labels[status.toLowerCase()] || status;
};

/**
 * Get impact display label
 */
const getImpactLabel = (impact: string): string => {
  const labels: Record<string, string> = {
    critical: "Critical",
    major: "Major",
    minor: "Minor",
    none: "None",
  };
  return labels[impact.toLowerCase()] || impact;
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
  unsubscribeUrl = "https://status.example.com/unsubscribe",
}: IncidentNotificationEmailProps) => {
  const colors = getIncidentColors(incidentStatus, incidentImpact);
  const statusLabel = getStatusLabel(incidentStatus);
  const impactLabel = getImpactLabel(incidentImpact);
  const isResolved = incidentStatus.toLowerCase() === "resolved";

  return (
    <Html>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
      </Head>
      <Preview>
        {isResolved ? "✓ Resolved" : `⚠ ${impactLabel}`}: {incidentName}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header with Status Page Name */}
          <Section style={{ ...header, backgroundColor: colors.headerBg }}>
            <Heading style={headerTitle}>{statusPageName}</Heading>
          </Section>

          {/* Status Badge */}
          <Section style={badgeContainer}>
            <span
              style={{
                ...statusBadge,
                backgroundColor: colors.badgeBg,
                color: colors.badgeText,
                border: `1px solid ${colors.borderColor}`,
              }}
            >
              {isResolved ? "✓ " : ""}
              {statusLabel.toUpperCase()}
            </span>
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
                ? `We're happy to inform you that the incident affecting ${statusPageName} has been resolved.`
                : `An incident has been reported affecting ${statusPageName}. We are working to resolve this issue as quickly as possible.`}
            </Text>
          </Section>

          {/* Status & Impact Info Box - Border Left Style */}
          <Section style={contentSection}>
            <table
              style={{
                ...infoBox,
                borderLeft: `4px solid ${colors.borderColor}`,
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
                            <Text style={{ ...infoLabel }}>Status</Text>
                            <Text
                              style={{ ...infoValue, color: colors.textColor }}
                            >
                              {statusLabel}
                            </Text>
                          </td>
                          <td style={{ width: "50%", verticalAlign: "top" }}>
                            <Text style={{ ...infoLabel }}>Impact</Text>
                            <Text
                              style={{ ...infoValue, color: colors.textColor }}
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
            <Text style={sectionLabel}>Update</Text>
            <Text style={descriptionText}>{incidentDescription}</Text>
            <Text style={timestampText}>Posted: {updateTimestamp}</Text>
          </Section>

          {/* Affected Components */}
          {affectedComponents.length > 0 && (
            <Section style={contentSection}>
              <table style={componentsBox} cellPadding="0" cellSpacing="0">
                <tbody>
                  <tr>
                    <td style={{ padding: "16px 20px" }}>
                      <Text style={componentsTitle}>Affected Services</Text>
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
            <Button style={ctaButton} href={statusPageUrl}>
              View Status Page
            </Button>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              You are receiving this notification because you subscribed to
              status updates for {statusPageName}.
            </Text>
            <Text style={footerLinks}>
              <Link href={statusPageUrl} style={footerLink}>
                View Status Page
              </Link>
              {" • "}
              <Link href={unsubscribeUrl} style={footerLink}>
                Unsubscribe
              </Link>
            </Text>
            <Text style={copyright}>
              Powered by{" "}
              <Link href="https://supercheck.io" style={footerLink}>
                Supercheck
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const main = {
  backgroundColor: "#f4f4f5",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  padding: "40px 20px",
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  maxWidth: "560px",
  borderRadius: "12px",
  overflow: "hidden" as const,
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
};

const header = {
  padding: "28px 32px",
  textAlign: "center" as const,
};

const headerTitle = {
  color: "#ffffff",
  fontSize: "20px",
  fontWeight: "600" as const,
  margin: "0",
  letterSpacing: "-0.01em",
};

const badgeContainer = {
  textAlign: "center" as const,
  padding: "24px 32px 0",
};

const statusBadge = {
  display: "inline-block",
  padding: "6px 14px",
  borderRadius: "20px",
  fontSize: "11px",
  fontWeight: "700" as const,
  letterSpacing: "0.5px",
  textTransform: "uppercase" as const,
};

const contentSection = {
  padding: "0 32px",
};

const incidentTitle = {
  color: "#18181b",
  fontSize: "22px",
  fontWeight: "700" as const,
  margin: "20px 0 16px",
  lineHeight: "1.3",
  letterSpacing: "-0.02em",
};

const introText = {
  color: "#52525b",
  fontSize: "15px",
  lineHeight: "1.65",
  margin: "0 0 24px",
  textAlign: "left" as const,
};

const infoBox = {
  width: "100%",
  backgroundColor: "#fafafa",
  borderRadius: "8px",
  marginBottom: "24px",
};

const infoLabel = {
  color: "#71717a",
  fontSize: "11px",
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  margin: "0 0 4px",
};

const infoValue = {
  fontSize: "16px",
  fontWeight: "600" as const,
  margin: "0",
};

const sectionLabel = {
  color: "#71717a",
  fontSize: "11px",
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  margin: "0 0 8px",
};

const descriptionText = {
  color: "#3f3f46",
  fontSize: "15px",
  lineHeight: "1.65",
  margin: "0 0 8px",
};

const timestampText = {
  color: "#a1a1aa",
  fontSize: "13px",
  margin: "0 0 24px",
};

const componentsBox = {
  width: "100%",
  backgroundColor: "#fafafa",
  border: "1px solid #e4e4e7",
  borderRadius: "8px",
  marginBottom: "24px",
};

const componentsTitle = {
  color: "#52525b",
  fontSize: "12px",
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  margin: "0 0 12px",
};

const componentItem = {
  color: "#3f3f46",
  fontSize: "14px",
  margin: "0 0 4px",
  lineHeight: "1.5",
};

const buttonSection = {
  textAlign: "center" as const,
  padding: "8px 32px 32px",
};

const ctaButton = {
  backgroundColor: "#18181b",
  borderRadius: "8px",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "600" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 28px",
};

const divider = {
  borderColor: "#e4e4e7",
  margin: "0",
};

const footer = {
  padding: "24px 32px",
  backgroundColor: "#fafafa",
};

const footerText = {
  color: "#71717a",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 12px",
  textAlign: "center" as const,
};

const footerLinks = {
  color: "#71717a",
  fontSize: "13px",
  margin: "0 0 12px",
  textAlign: "center" as const,
};

const footerLink = {
  color: "#52525b",
  textDecoration: "underline",
};

const copyright = {
  color: "#a1a1aa",
  fontSize: "12px",
  margin: "0",
  textAlign: "center" as const,
};

export default IncidentNotificationEmail;
