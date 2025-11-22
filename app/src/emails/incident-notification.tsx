import {
  Button,
  Link,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { BaseLayout } from "./base-layout";

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

const getImpactColors = (
  impact: string
): { bgColor: string; textColor: string; headerBg: string } => {
  switch (impact.toLowerCase()) {
    case "critical":
      return {
        bgColor: "#fef2f2",
        textColor: "#b91c1c", // Red-700
        headerBg: "#ef4444", // Red-500
      };
    case "major":
      return {
        bgColor: "#fff7ed",
        textColor: "#c2410c", // Orange-700
        headerBg: "#f97316", // Orange-500
      };
    case "minor":
      return {
        bgColor: "#fffbeb",
        textColor: "#b45309", // Amber-700
        headerBg: "#f59e0b", // Amber-500
      };
    default:
      return {
        bgColor: "#f3f4f6",
        textColor: "#374151", // Gray-700
        headerBg: "#6b7280", // Gray-500
      };
  }
};

export const IncidentNotificationEmail = ({
  statusPageName = "Example Status Page",
  statusPageUrl = "https://example.supercheck.io",
  incidentName = "API Service Degradation",
  incidentStatus = "investigating",
  incidentImpact = "major",
  incidentDescription = "We are currently investigating issues with API response times.",
  affectedComponents = ["API Service", "Database"],
  updateTimestamp = new Date().toLocaleString(),
  unsubscribeUrl = "https://example.supercheck.io/unsubscribe?token=abc123",
}: IncidentNotificationEmailProps) => {
  const colors = getImpactColors(incidentImpact);
  const formattedStatus = incidentStatus
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return (
    <BaseLayout
      preview={`[${incidentStatus.toUpperCase()}] ${incidentName} - ${statusPageName}`}
      title={statusPageName}
      headerColor={colors.headerBg}
      footer={
        <Text style={footerText}>
          You are receiving this email because you are subscribed to {statusPageName}.
          <br />
          <Link href={unsubscribeUrl} style={footerLink}>
            Unsubscribe
          </Link>
        </Text>
      }
    >
      <Section style={headerSection}>
        <Text style={notificationLabel}>
          Incident Notification
        </Text>
      </Section>

      <Section style={{ ...impactBadge, backgroundColor: colors.bgColor, color: colors.textColor }}>
        {incidentImpact.toUpperCase()} IMPACT
      </Section>

      <Text style={incidentTitle}>{incidentName}</Text>

      <Section
        style={{
          ...statusBox,
          backgroundColor: colors.bgColor,
          borderLeftColor: colors.textColor,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td style={{ paddingRight: "24px", verticalAlign: "top" }}>
                <Text style={{ ...statusLabel, color: colors.textColor }}>STATUS</Text>
                <Text style={{ ...statusValue, color: colors.textColor }}>{formattedStatus}</Text>
              </td>
              <td style={{ verticalAlign: "top" }}>
                <Text style={{ ...statusLabel, color: colors.textColor }}>UPDATED</Text>
                <Text style={{ ...statusValueSmall, color: colors.textColor }}>
                  {updateTimestamp}
                </Text>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Text style={sectionTitle}>Description</Text>
      <Text style={description}>{incidentDescription}</Text>

      {affectedComponents.length > 0 && (
        <Section style={componentsBox}>
          <Text style={componentsTitle}>Affected Services</Text>
          <ul style={list}>
            {affectedComponents.map((component, index) => (
              <li key={index} style={listItem}>
                {component}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section style={buttonContainer}>
        <Button style={button} href={statusPageUrl}>
          View Full Status
        </Button>
      </Section>

      <Text style={linkText}>
        <Link href={statusPageUrl} style={link}>
          View this incident and others on our status page
        </Link>
      </Text>
    </BaseLayout>
  );
};

const headerSection = {
  textAlign: "center" as const,
  padding: "32px 32px 0",
};

const notificationLabel = {
  color: "#6b7280",
  fontSize: "13px",
  fontWeight: "500" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  margin: "0 0 16px",
};

const impactBadge = {
  display: "inline-block",
  padding: "6px 12px",
  borderRadius: "16px",
  fontSize: "12px",
  fontWeight: "700",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  margin: "0 32px 24px",
};

const incidentTitle = {
  color: "#111827",
  fontSize: "24px",
  fontWeight: "700",
  margin: "0 32px 24px",
  lineHeight: "1.3",
};

const statusBox = {
  borderLeft: "4px solid",
  borderRadius: "0 4px 4px 0",
  padding: "20px",
  margin: "0 32px 32px",
};

const statusLabel = {
  fontSize: "12px",
  fontWeight: "700",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  margin: "0 0 4px",
  opacity: 0.8,
};

const statusValue = {
  fontSize: "18px",
  fontWeight: "600",
  margin: "0",
};

const statusValueSmall = {
  fontSize: "14px",
  margin: "0",
  fontWeight: "500" as const,
};

const sectionTitle = {
  color: "#374151",
  fontSize: "16px",
  fontWeight: "600",
  margin: "0 32px 12px",
};

const description = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.6",
  whiteSpace: "pre-wrap" as const,
  margin: "0 32px 32px",
};

const componentsBox = {
  backgroundColor: "#f9fafb",
  padding: "20px",
  borderRadius: "8px",
  margin: "0 32px 32px",
  border: "1px solid #e5e7eb",
};

const componentsTitle = {
  color: "#374151",
  fontWeight: "600",
  fontSize: "14px",
  margin: "0 0 12px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

const list = {
  margin: "0",
  paddingLeft: "20px",
  color: "#4b5563",
  fontSize: "14px",
  lineHeight: "1.6",
};

const listItem = {
  marginBottom: "4px",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "0 0 32px",
  padding: "0 32px",
};

const button = {
  backgroundColor: "#111827",
  borderRadius: "6px",
  color: "#fff",
  fontSize: "14px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 24px",
};

const linkText = {
  color: "#6b7280",
  fontSize: "13px",
  textAlign: "center" as const,
  margin: "0 0 32px",
};

const link = {
  color: "#4b5563",
  textDecoration: "underline",
};

const footerText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 16px",
};

const footerLink = {
  color: "#4b5563",
  textDecoration: "underline",
};

export default IncidentNotificationEmail;
