import {
  Button,
  Link,
  Section,
  Text,
} from "@react-email/components";
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
      title="You're All Set! ✓"
      headerColor="linear-gradient(135deg, #10b981 0%, #059669 100%)"
      footer={
        <>
          <Text style={footerText}>
            You&apos;re now subscribed to <strong>{statusPageName}</strong> status updates
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
      <Text style={paragraph}>
        Your subscription to{" "}
        <strong style={{ color: "#1f2937" }}>{statusPageName}</strong> has been confirmed.
      </Text>

      <Section style={infoBox}>
        <Text style={infoTitle}>You&apos;ll receive notifications for:</Text>
        <ul style={list}>
          <li style={listItem}>Service incidents and outages</li>
          <li style={listItem}>Scheduled maintenance windows</li>
          <li style={listItem}>Incident updates and resolutions</li>
        </ul>
      </Section>

      <Text style={paragraph}>You can view the current status at any time:</Text>

      <Section style={buttonContainer}>
        <Button style={button} href={statusPageUrl}>
          View Status Page
        </Button>
      </Section>
    </BaseLayout>
  );
};

const paragraph = {
  color: "#374151",
  fontSize: "16px",
  lineHeight: "1.5",
  margin: "0 0 24px",
};

const infoBox = {
  backgroundColor: "#f0fdf4",
  borderLeft: "4px solid #10b981",
  borderRadius: "4px",
  padding: "16px",
  margin: "24px 0",
};

const infoTitle = {
  color: "#166534",
  fontSize: "14px",
  fontWeight: "600",
  margin: "0 0 12px",
};

const list = {
  margin: "0",
  paddingLeft: "20px",
  color: "#166534",
  fontSize: "14px",
  lineHeight: "1.6",
};

const listItem = {
  marginBottom: "4px",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "16px 0",
};

const button = {
  backgroundColor: "#f3f4f6",
  borderRadius: "6px",
  color: "#374151",
  fontSize: "14px",
  fontWeight: "500",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 24px",
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

export default StatusPageWelcomeEmail;
