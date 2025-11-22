import { Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout } from "./base-layout";

interface TestEmailProps {
  testMessage?: string;
}

export const TestEmail = ({
  testMessage = "This is a test email to verify your SMTP configuration is working correctly.",
}: TestEmailProps) => {
  return (
    <BaseLayout
      preview="Test Email from Supercheck"
      title="Email Configuration Test"
      headerColor="#3b82f6" // Blue-500
    >
      <Section style={contentSection}>
        <Text style={heading}>Email Test Successful</Text>

        <Text style={paragraph}>
          Your email configuration is working properly.
        </Text>

        <Text style={paragraph}>{testMessage}</Text>

        <Section style={infoBox}>
          <Text style={infoTitle}>Email Details</Text>
          <Text style={infoText}>
            • Status: Delivered Successfully
            <br />• Timestamp: {new Date().toLocaleString()}
          </Text>
        </Section>

        <Text style={smallText}>
          This is an automated test email from Supercheck. If you received this, your email
          notifications are configured correctly.
        </Text>
      </Section>
    </BaseLayout>
  );
};

const contentSection = {
  padding: "32px 32px 0",
};

const heading = {
  color: "#111827",
  fontSize: "22px",
  fontWeight: "700" as const,
  margin: "0 0 20px",
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

const infoBox = {
  backgroundColor: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  padding: "24px",
  margin: "32px 0",
};

const infoTitle = {
  color: "#1f2937",
  fontSize: "14px",
  fontWeight: "600" as const,
  margin: "0 0 12px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

const infoText = {
  color: "#4b5563",
  fontSize: "14px",
  lineHeight: "1.8",
  margin: "0",
};

const smallText = {
  color: "#9ca3af",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "32px 0 0",
  textAlign: "center" as const,
};

export default TestEmail;
