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
      return "#ef4444"; // Red-500
    case "success":
      return "#22c55e"; // Green-500
    case "warning":
      return "#f59e0b"; // Amber-500
    default:
      return "#3b82f6"; // Blue-500
  }
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
  color,
}: MonitorAlertEmailProps) => {
  const statusColor = color ?? getStatusColor(type);

  // Helper to check if a string is a URL
  const isUrl = (str: string) => {
    try {
      new URL(str);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <BaseLayout
      preview={title}
      title="Supercheck Notification"
      headerColor={statusColor}
      // We use the standard footer from BaseLayout, but append the custom footer text if needed
      // or just rely on the standard one. The prompt asked for a proper footer consistent across all templates.
      // The BaseLayout now has a standard footer. We can pass this custom footer as null to use the default,
      // or pass it if it contains specific info.
      // Let's pass the custom footer text as a simple text block above the standard footer links if it's unique.
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
            {fields.map((field, index) => {
              const isLink =
                isUrl(field.value) ||
                field.title.toLowerCase().includes("url") ||
                field.title.toLowerCase().includes("link");
              
              return (
                <tr key={index}>
                  <td style={detailsLabelCell}>{field.title}</td>
                  <td style={detailsValueCell}>
                    {isLink ? (
                      <Link href={field.value} style={linkStyle}>
                        {field.value}
                      </Link>
                    ) : (
                      field.value
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
    </BaseLayout>
  );
};

// ============================================================================
// TITLE & MESSAGE STYLES
// ============================================================================

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
  margin: "0 32px 32px",
  borderRadius: "0 4px 4px 0",
};

const messageText = {
  margin: "0",
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.6",
  whiteSpace: "pre-wrap" as const,
};

// ============================================================================
// DETAILS TABLE STYLES
// ============================================================================

const detailsSection = {
  padding: "0 32px 32px",
};

const detailsTitle = {
  color: "#374151",
  fontSize: "16px",
  fontWeight: "600" as const,
  margin: "0 0 16px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

const detailsTable = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const detailsLabelCell = {
  padding: "12px 16px",
  fontWeight: "600" as const,
  verticalAlign: "top" as const,
  borderBottom: "1px solid #e5e7eb",
  color: "#6b7280",
  fontSize: "14px",
  width: "30%",
  backgroundColor: "#f9fafb",
  textAlign: "left" as const,
};

const detailsValueCell = {
  padding: "12px 16px",
  verticalAlign: "top" as const,
  borderBottom: "1px solid #e5e7eb",
  color: "#111827",
  fontSize: "14px",
  textAlign: "left" as const,
  wordBreak: "break-all" as const,
};

// ============================================================================
// LINK STYLES
// ============================================================================

const linkStyle = {
  color: "#2563eb",
  textDecoration: "none",
  fontWeight: "500" as const,
};

// ============================================================================
// FOOTER STYLES
// ============================================================================

const customFooterText = {
  color: "#6b7280",
  fontSize: "13px",
  margin: "0 0 16px",
};

export default MonitorAlertEmail;
