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
      headerColor="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
    >
      <Section style={{ textAlign: "center", marginBottom: "24px" }}>
        <Text style={{ fontSize: "48px", margin: "0" }}>✉️</Text>
      </Section>

      <Text style={paragraph}>
        <strong>Success!</strong> Your email configuration is working properly.
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

const paragraph = {
  color: "#374151",
  fontSize: "16px",
  lineHeight: "1.5",
  margin: "0 0 24px",
};

const infoBox = {
  backgroundColor: "#f0f9ff",
  borderLeft: "4px solid #0284c7",
  borderRadius: "4px",
  padding: "16px",
  margin: "24px 0",
};

const infoTitle = {
  color: "#075985",
  fontSize: "14px",
  fontWeight: "600",
  margin: "0 0 12px",
};

const infoText = {
  color: "#0c4a6e",
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
