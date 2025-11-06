import { Button, Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout } from "./base-layout";

interface AlertField {
  title: string;
  value: string;
}

interface MonitorAlertEmailProps {
  title: string;
  message: string;
  fields: AlertField[];
  footer: string;
  type: "failure" | "success" | "warning";
  color: string;
}

/**
 * Get status color for visual indicators
 */
const getStatusColor = (type: string): string => {
  switch (type) {
    case "failure":
      return "#dc2626"; // Red
    case "success":
      return "#16a34a"; // Green
    case "warning":
      return "#ea580c"; // Orange
    default:
      return "#2563eb"; // Blue
  }
};

/**
 * Get status badge with professional styling
 */
const getStatusBadge = (type: string, color: string): React.ReactNode => {
  const badgeText =
    type === "failure" ? "ALERT" : type === "success" ? "SUCCESS" : "WARNING";

  return (
    <div style={badgeContainer}>
      <span style={{ ...badge, backgroundColor: color }}>
        {badgeText}
      </span>
    </div>
  );
};

export const MonitorAlertEmail = ({
  title = "Monitor Alert",
  message = "Your monitor has detected an issue",
  fields = [
    { title: "Monitor", value: "Example Monitor" },
    { title: "Status", value: "Failed" },
  ],
  footer = "Supercheck Monitoring System",
  type = "failure",
  color = "#dc2626",
}: MonitorAlertEmailProps) => {
  const statusColor = getStatusColor(type);
  const statusBadge = getStatusBadge(type, statusColor);

  // Extract dashboard URL from fields if present
  const dashboardField = fields.find((f) =>
    f.title.toLowerCase().includes("dashboard")
  );

  return (
    <BaseLayout
      preview={title}
      title="System Notification"
      footer={
        <>
          <Text style={footerText}>{footer}</Text>
          <Text style={footerSmall}>
            This is an automated notification from Supercheck monitoring system.
          </Text>
        </>
      }
    >
      {/* Status Badge */}
      {statusBadge}

      {/* Alert Title */}
      <Text style={alertTitle}>{title}</Text>

      {/* Alert Message */}
      <Section style={{ ...messageBox, borderLeftColor: statusColor }}>
        <Text style={messageText}>{message}</Text>
      </Section>

      {/* Details Table */}
      <Section style={detailsSection}>
        <Text style={detailsTitle}>Alert Details</Text>
        <table style={detailsTable}>
          <tbody>
            {fields
              .filter((f) => !f.title.toLowerCase().includes("dashboard"))
              .map((field, index) => (
                <tr key={index}>
                  <td style={detailsLabelCell}>{field.title}</td>
                  <td style={detailsValueCell}>{field.value}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Section>

      {/* Call to Action */}
      {dashboardField && (
        <Section style={ctaSection}>
          <Button style={ctaButton} href={dashboardField.value}>
            View Full Details
          </Button>
        </Section>
      )}
    </BaseLayout>
  );
};

// ============================================================================
// BADGE STYLES
// ============================================================================

const badgeContainer = {
  textAlign: "center" as const,
  marginBottom: "28px",
};

const badge = {
  display: "inline-block",
  padding: "8px 16px",
  color: "#ffffff",
  borderRadius: "4px",
  fontSize: "11px",
  fontWeight: "700" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.8px",
};

// ============================================================================
// TITLE & MESSAGE STYLES
// ============================================================================

const alertTitle = {
  color: "#111827",
  fontSize: "24px",
  fontWeight: "700" as const,
  margin: "0 0 20px",
  lineHeight: "1.3",
  textAlign: "center" as const,
};

const messageBox = {
  backgroundColor: "#f8fafc",
  borderLeft: "4px solid",
  padding: "20px 24px",
  margin: "0 0 32px",
  borderRadius: "8px",
};

const messageText = {
  margin: "0",
  color: "#475569",
  fontSize: "15px",
  lineHeight: "1.6",
  whiteSpace: "pre-wrap" as const,
};

// ============================================================================
// DETAILS TABLE STYLES
// ============================================================================

const detailsSection = {
  marginTop: "32px",
};

const detailsTitle = {
  color: "#374151",
  fontSize: "14px",
  fontWeight: "700" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  margin: "0 0 16px",
};

const detailsTable = {
  width: "100%",
  backgroundColor: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  borderCollapse: "separate" as const,
  borderSpacing: "0",
  overflow: "hidden",
};

const detailsLabelCell = {
  padding: "14px 16px",
  fontWeight: "600" as const,
  verticalAlign: "top" as const,
  borderBottom: "1px solid #f3f4f6",
  color: "#6b7280",
  fontSize: "13px",
  width: "160px",
  backgroundColor: "#fafafa",
};

const detailsValueCell = {
  padding: "14px 16px",
  verticalAlign: "top" as const,
  borderBottom: "1px solid #f3f4f6",
  color: "#111827",
  fontSize: "14px",
  fontWeight: "500" as const,
};

// ============================================================================
// CTA STYLES
// ============================================================================

const ctaSection = {
  textAlign: "center" as const,
  marginTop: "40px",
};

const ctaButton = {
  backgroundColor: "#1f2937",
  borderRadius: "6px",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "600" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 28px",
};

// ============================================================================
// FOOTER STYLES
// ============================================================================

const footerText = {
  color: "#6b7280",
  fontSize: "14px",
  margin: "0 0 4px",
  fontWeight: "500" as const,
};

const footerSmall = {
  color: "#9ca3af",
  fontSize: "12px",
  margin: "4px 0 0 0",
  lineHeight: "1.5",
};

export default MonitorAlertEmail;
