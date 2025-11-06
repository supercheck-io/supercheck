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
        textColor: "#991b1b",
        headerBg: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
      };
    case "major":
      return {
        bgColor: "#fff7ed",
        textColor: "#92400e",
        headerBg: "linear-gradient(135deg, #ea580c 0%, #c2410c 100%)",
      };
    case "minor":
      return {
        bgColor: "#fffbeb",
        textColor: "#78350f",
        headerBg: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
      };
    default:
      return {
        bgColor: "#f3f4f6",
        textColor: "#374151",
        headerBg: "linear-gradient(135deg, #6b7280 0%, #4b5563 100%)",
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
        <>
          <Text style={footerText}>
            Incident notification from <strong>{statusPageName}</strong> status page
          </Text>
          <Text style={footerSmall}>
            <Link href={unsubscribeUrl} style={footerLink}>
              Unsubscribe
            </Link>{" "}
            •{" "}
            <Link href="https://supercheck.io" style={footerLink}>
              Powered by Supercheck
            </Link>
          </Text>
        </>
      }
    >
      <Section style={{ textAlign: "center", marginBottom: "16px" }}>
        <Text style={{ fontSize: "32px", margin: "0" }}>⚠️</Text>
        <Text style={{ color: "#6b7280", fontSize: "14px", margin: "8px 0 0" }}>
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

      <Text style={sectionTitle}>Description:</Text>
      <Text style={description}>{incidentDescription}</Text>

      {affectedComponents.length > 0 && (
        <Section style={componentsBox}>
          <Text style={componentsTitle}>Affected Services:</Text>
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

const impactBadge = {
  display: "inline-block",
  padding: "8px 16px",
  borderRadius: "20px",
  fontSize: "13px",
  fontWeight: "600",
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  margin: "0 0 24px",
};

const incidentTitle = {
  color: "#1f2937",
  fontSize: "20px",
  fontWeight: "600",
  margin: "0 0 24px",
};

const statusBox = {
  borderLeft: "4px solid",
  borderRadius: "4px",
  padding: "16px",
  margin: "0 0 24px",
};

const statusLabel = {
  fontSize: "13px",
  fontWeight: "600",
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  margin: "0 0 8px",
};

const statusValue = {
  fontSize: "16px",
  fontWeight: "600",
  margin: "0",
};

const statusValueSmall = {
  fontSize: "14px",
  margin: "0",
};

const sectionTitle = {
  color: "#374151",
  fontSize: "15px",
  fontWeight: "600",
  margin: "0 0 16px",
};

const description = {
  color: "#6b7280",
  fontSize: "15px",
  lineHeight: "1.6",
  whiteSpace: "pre-wrap" as const,
  margin: "0 0 24px",
};

const componentsBox = {
  backgroundColor: "#f9fafb",
  padding: "16px",
  borderRadius: "6px",
  margin: "24px 0",
};

const componentsTitle = {
  color: "#374151",
  fontWeight: "600",
  fontSize: "14px",
  margin: "0 0 12px",
};

const list = {
  margin: "0",
  paddingLeft: "20px",
  color: "#6b7280",
  fontSize: "14px",
  lineHeight: "1.6",
};

const listItem = {
  marginBottom: "6px",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0 24px",
};

const button = {
  backgroundColor: "#667eea",
  borderRadius: "6px",
  color: "#fff",
  fontSize: "16px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "14px 40px",
};

const linkText = {
  color: "#6b7280",
  fontSize: "13px",
  textAlign: "center" as const,
  margin: "0",
};

const link = {
  color: "#667eea",
  textDecoration: "none",
};

const footerText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 8px 0",
};

const footerSmall = {
  color: "#9ca3af",
  fontSize: "12px",
  margin: "0",
};

const footerLink = {
  color: "#9ca3af",
  textDecoration: "none",
};

export default IncidentNotificationEmail;
