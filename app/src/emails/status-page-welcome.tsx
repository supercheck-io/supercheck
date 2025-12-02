import { Button, Hr, Link, Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout } from "./base-layout";

interface StatusPageWelcomeEmailProps {
  statusPageName: string;
  statusPageUrl: string;
  unsubscribeUrl: string;
}

export const StatusPageWelcomeEmail = ({
  statusPageName = "Example Status Page",
  statusPageUrl = "https://example.supercheck.io",
  unsubscribeUrl = "https://example.supercheck.io/unsubscribe?token=abc123",
}: StatusPageWelcomeEmailProps) => {
  return (
    <BaseLayout
      preview={`You're now subscribed to ${statusPageName}`}
      title="Subscription Confirmed"
      headerColor="#16a34a"
      footer={
        <Text style={footerText}>
          You&apos;re now subscribed to <strong>{statusPageName}</strong> status
          updates.
          <br />
          <Link href={unsubscribeUrl} style={footerLink}>
            Unsubscribe
          </Link>
        </Text>
      }
    >
      <Section style={headerSection}>
        <Text style={notificationLabel}>Subscription Active</Text>
      </Section>

      <Section style={contentSection}>
        <Text style={heading}>You&apos;re All Set! ✓</Text>

        <Text style={paragraph}>
          Your subscription to{" "}
          <strong style={{ color: "#111827" }}>{statusPageName}</strong> has
          been confirmed.
        </Text>

        <Section style={successBox}>
          <Text style={successTitle}>🎉 What happens next?</Text>
          <Text style={successText}>
            You&apos;ll receive email notifications whenever there are updates
            to the services you care about.
          </Text>
        </Section>

        <Section style={infoBox}>
          <Text style={infoTitle}>You&apos;ll receive notifications for:</Text>
          <table style={listTable}>
            <tbody>
              <tr>
                <td style={bulletCell}>•</td>
                <td style={listItemCell}>Service incidents and outages</td>
              </tr>
              <tr>
                <td style={bulletCell}>•</td>
                <td style={listItemCell}>Scheduled maintenance windows</td>
              </tr>
              <tr>
                <td style={bulletCell}>•</td>
                <td style={listItemCell}>Incident updates and resolutions</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Text style={paragraph}>
          You can view the current status at any time:
        </Text>

        <Section style={buttonContainer}>
          <Button style={button} href={statusPageUrl}>
            View Status Page
          </Button>
        </Section>

        <Hr style={hr} />

        <Text style={tipsText}>
          <strong>Pro tip:</strong> Add our email address to your contacts to
          ensure you never miss an important update.
        </Text>
      </Section>
    </BaseLayout>
  );
};

// ============================================================================
// HEADER STYLES
// ============================================================================

const headerSection = {
  textAlign: "center" as const,
  padding: "32px 32px 0",
};

const notificationLabel = {
  color: "#16a34a",
  fontSize: "12px",
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  margin: "0 0 8px",
  backgroundColor: "#f0fdf4",
  display: "inline-block",
  padding: "4px 12px",
  borderRadius: "16px",
};

// ============================================================================
// CONTENT STYLES
// ============================================================================

const contentSection = {
  padding: "0 32px",
};

const heading = {
  color: "#111827",
  fontSize: "24px",
  fontWeight: "700" as const,
  lineHeight: "1.3",
  margin: "0 0 24px",
  textAlign: "center" as const,
  letterSpacing: "-0.025em",
};

const paragraph = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 24px",
  textAlign: "center" as const,
};

// ============================================================================
// SUCCESS BOX STYLES
// ============================================================================

const successBox = {
  backgroundColor: "#f0fdf4",
  border: "1px solid #bbf7d0",
  borderRadius: "8px",
  padding: "20px",
  margin: "0 0 24px",
  textAlign: "center" as const,
};

const successTitle = {
  color: "#166534",
  fontSize: "15px",
  fontWeight: "600" as const,
  margin: "0 0 8px",
};

const successText = {
  color: "#166534",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0",
};

// ============================================================================
// INFO BOX STYLES
// ============================================================================

const infoBox = {
  backgroundColor: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  padding: "20px",
  margin: "0 0 24px",
};

const infoTitle = {
  color: "#374151",
  fontSize: "14px",
  fontWeight: "600" as const,
  margin: "0 0 12px",
};

const listTable = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const bulletCell = {
  color: "#16a34a",
  fontSize: "14px",
  fontWeight: "700" as const,
  verticalAlign: "top" as const,
  paddingRight: "8px",
  width: "16px",
};

const listItemCell = {
  color: "#4b5563",
  fontSize: "14px",
  lineHeight: "1.6",
  paddingBottom: "4px",
};

// ============================================================================
// BUTTON STYLES
// ============================================================================

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button = {
  backgroundColor: "#16a34a",
  borderRadius: "6px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "600" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "14px 36px",
};

const hr = {
  borderColor: "#e5e7eb",
  margin: "24px 0",
};

// ============================================================================
// TIPS STYLES
// ============================================================================

const tipsText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 32px",
  textAlign: "center" as const,
};

// ============================================================================
// FOOTER STYLES
// ============================================================================

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

export default StatusPageWelcomeEmail;
