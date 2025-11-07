import { Link, Section, Text } from "@react-email/components";
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
  color?: string;
}

/**
 * Get status color for visual indicators
 */
const getStatusColor = (type: string): string => {
  switch (type) {
    case "failure":
      return "#ff4d4f"; // Red
    case "success":
      return "#52c41a"; // Green
    case "warning":
      return "#faad14"; // Orange
    default:
      return "#1890ff"; // Blue
  }
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
  color,
}: MonitorAlertEmailProps) => {
  const statusColor = color ?? getStatusColor(type);

  // Extract dashboard URL from fields if present
  const dashboardField = fields.find((f) =>
    f.title.toLowerCase().includes("dashboard") ||
    f.title.toLowerCase().includes("monitor details")
  );

  return (
    <BaseLayout
      preview={title}
      title="Supercheck Notification"
      headerColor={statusColor}
      footer={
        <Text style={footerText}>
          {footer}
        </Text>
      }
    >
      {/* Alert Title */}
      <Section style={titleSection}>
        <Text style={alertTitle}>{title}</Text>
      </Section>

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
              .filter((f) =>
                !f.title.toLowerCase().includes("dashboard") &&
                !f.title.toLowerCase().includes("monitor details")
              )
              .map((field, index) => (
                <tr key={index}>
                  <td style={detailsLabelCell}>{field.title}:</td>
                  <td style={detailsValueCell}>{field.value}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Section>

      {/* Dashboard Link */}
      {dashboardField && (
        <Section style={linkSection}>
          <Text style={linkText}>
            <Link href={dashboardField.value} style={linkStyle}>
              {dashboardField.value}
            </Link>
          </Text>
        </Section>
      )}
    </BaseLayout>
  );
};

// ============================================================================
// TITLE & MESSAGE STYLES
// ============================================================================

const titleSection = {
  padding: "30px 30px 0",
};

const alertTitle = {
  color: "#333333",
  fontSize: "20px",
  fontWeight: "bold" as const,
  margin: "0 0 20px",
  lineHeight: "1.4",
  textAlign: "left" as const,
};

const messageBox = {
  backgroundColor: "#f8f8f8",
  borderLeft: "4px solid",
  padding: "15px 20px",
  margin: "0 30px 30px",
};

const messageText = {
  margin: "0",
  color: "#666666",
  fontSize: "14px",
  lineHeight: "1.6",
  whiteSpace: "pre-wrap" as const,
};

// ============================================================================
// DETAILS TABLE STYLES
// ============================================================================

const detailsSection = {
  padding: "0 30px 30px",
};

const detailsTitle = {
  color: "#333333",
  fontSize: "16px",
  fontWeight: "bold" as const,
  margin: "0 0 15px",
};

const detailsTable = {
  width: "100%",
  backgroundColor: "#ffffff",
  border: "1px solid #e0e0e0",
  borderCollapse: "collapse" as const,
  fontSize: "14px",
};

const detailsLabelCell = {
  padding: "12px 15px",
  fontWeight: "600" as const,
  verticalAlign: "top" as const,
  borderBottom: "1px solid #e0e0e0",
  color: "#666666",
  fontSize: "14px",
  backgroundColor: "#fafafa",
  textAlign: "left" as const,
};

const detailsValueCell = {
  padding: "12px 15px",
  verticalAlign: "top" as const,
  borderBottom: "1px solid #e0e0e0",
  color: "#333333",
  fontSize: "14px",
  textAlign: "left" as const,
};

// ============================================================================
// LINK STYLES
// ============================================================================

const linkSection = {
  padding: "0 30px 30px",
};

const linkText = {
  margin: "0",
  fontSize: "13px",
  color: "#666666",
};

const linkStyle = {
  color: "#1890ff",
  textDecoration: "none",
  wordBreak: "break-all" as const,
};

// ============================================================================
// FOOTER STYLES
// ============================================================================

const footerText = {
  color: "#999999",
  fontSize: "12px",
  margin: "0",
  lineHeight: "1.5",
};

export default MonitorAlertEmail;
