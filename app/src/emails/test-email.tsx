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
    >
      <Text style={heading}>Email Test Successful</Text>

      <Text style={paragraph}>
        Your email configuration is working properly.
      </Text>

      <Text style={paragraph}>{testMessage}</Text>

      <Section style={infoBox}>
        <Text style={infoTitle}>Email Details:</Text>
        <Text style={infoText}>
          • Sent via: SMTP
          <br />
          • Template Engine: React Email
          <br />
          • Status: Delivered Successfully
          <br />• Timestamp: {new Date().toLocaleString()}
        </Text>
      </Section>

      <Text style={smallText}>
        This is an automated test email from Supercheck. If you received this, your email
        notifications are configured correctly.
      </Text>
    </BaseLayout>
  );
};

const heading = {
  color: "#111827",
  fontSize: "22px",
  fontWeight: "600" as const,
  margin: "0 0 20px",
  textAlign: "center" as const,
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
  borderRadius: "6px",
  padding: "20px",
  margin: "24px 0",
};

const infoTitle = {
  color: "#1f2937",
  fontSize: "14px",
  fontWeight: "600" as const,
  margin: "0 0 12px",
};

const infoText = {
  color: "#4b5563",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0",
};

const smallText = {
  color: "#6b7280",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "24px 0 0",
};

export default TestEmail;
