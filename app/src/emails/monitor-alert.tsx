import { Section, Text } from "@react-email/components";
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

const getStatusIcon = (type: string): string => {
  switch (type) {
    case "failure":
      return "🔴";
    case "success":
      return "✅";
    case "warning":
      return "⚠️";
    default:
      return "ℹ️";
  }
};

const getStatusBadge = (type: string, color: string): React.ReactNode => {
  const badgeText = type === "failure" ? "ALERT" : type === "success" ? "RESOLVED" : "WARNING";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "8px 16px",
        backgroundColor: color,
        color: "#ffffff",
        borderRadius: "4px",
        fontSize: "13px",
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
      }}
    >
      {badgeText}
    </span>
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
  const statusIcon = getStatusIcon(type);
  const statusBadge = getStatusBadge(type, color);

  return (
    <BaseLayout
      preview={title}
      title="Supercheck Monitoring Alert"
      headerColor="#667eea"
      footer={
        <>
          <Text style={footerText}>{footer}</Text>
          <Text style={footerSmall}>This is an automated notification from your monitoring system.</Text>
        </>
      }
    >
      <Section style={{ textAlign: "center", marginBottom: "16px" }}>
        <div
          style={{
            background: "rgba(102, 126, 234, 0.1)",
            display: "inline-block",
            padding: "12px",
            borderRadius: "50%",
            fontSize: "32px",
          }}
        >
          {statusIcon}
        </div>
        <Text style={{ color: "#6b7280", fontSize: "16px", margin: "8px 0 0", opacity: 0.9 }}>
          System Status Notification
        </Text>
      </Section>

      <Section style={{ marginBottom: "16px" }}>{statusBadge}</Section>

      <Text style={alertTitle}>{title}</Text>

      <Section
        style={{
          ...messageBox,
          borderLeftColor: color,
        }}
      >
        <Text style={messageText}>{message.replace(/\n/g, "\n")}</Text>
      </Section>

      <Text style={detailsTitle}>ALERT DETAILS</Text>

      <table style={detailsTable}>
        <tbody>
          {fields.map((field, index) => (
            <tr key={index}>
              <td style={detailsLabelCell}>{field.title}:</td>
              <td style={detailsValueCell}>{field.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </BaseLayout>
  );
};

const alertTitle = {
  color: "#1e293b",
  fontSize: "20px",
  fontWeight: "bold",
  margin: "0 0 8px",
};

const messageBox = {
  backgroundColor: "#f8fafc",
  borderLeft: "4px solid",
  padding: "16px 20px",
  margin: "16px 0 24px",
  borderRadius: "4px",
};

const messageText = {
  margin: "0",
  color: "#475569",
  fontSize: "15px",
  lineHeight: "1.6",
  whiteSpace: "pre-wrap" as const,
};

const detailsTitle = {
  color: "#1e293b",
  fontSize: "16px",
  fontWeight: "bold",
  textTransform: "uppercase" as const,
  margin: "0 0 16px",
};

const detailsTable = {
  width: "100%",
  backgroundColor: "#ffffff",
  border: "1px solid #e2e8f0",
  borderCollapse: "collapse" as const,
};

const detailsLabelCell = {
  padding: "12px 16px",
  fontWeight: "600",
  verticalAlign: "top",
  borderBottom: "1px solid #f1f5f9",
  color: "#475569",
  fontSize: "14px",
  width: "140px",
};

const detailsValueCell = {
  padding: "12px 16px",
  verticalAlign: "top",
  borderBottom: "1px solid #f1f5f9",
  color: "#334155",
  fontSize: "14px",
};

const footerText = {
  color: "#64748b",
  fontSize: "13px",
  margin: "0 0 8px",
};

const footerSmall = {
  color: "#94a3b8",
  fontSize: "12px",
  margin: "0",
};

export default MonitorAlertEmail;
