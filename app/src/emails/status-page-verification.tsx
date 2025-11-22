import {
  Button,
  Hr,
  Link,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { BaseLayout } from "./base-layout";

interface StatusPageVerificationEmailProps {
  verificationUrl: string;
  statusPageName: string;
}

export const StatusPageVerificationEmail = ({
  verificationUrl = "https://supercheck.io/verify?token=abc123",
  statusPageName = "Example Status Page",
}: StatusPageVerificationEmailProps) => {
  return (
    <BaseLayout
      preview={`Verify your subscription to ${statusPageName}`}
      title="Verify Your Subscription"
      headerColor="#1f2937"
      footer={
        <Text style={footerText}>
          This email was sent because you subscribed to status updates from{" "}
          <strong>{statusPageName}</strong>.
        </Text>
      }
    >
      <Section style={contentSection}>
        <Text style={paragraph}>
          Thank you for subscribing to{" "}
          <strong style={{ color: "#1f2937" }}>{statusPageName}</strong> status updates!
        </Text>

        <Text style={paragraph}>
          To complete your subscription and start receiving notifications about incidents and
          maintenance, please verify your email address:
        </Text>

        <Section style={buttonContainer}>
          <Button style={button} href={verificationUrl}>
            Verify Email Address
          </Button>
        </Section>

        <Text style={smallText}>
          Or copy and paste this URL into your browser:
        </Text>
        <Text style={urlText}>
          <Link href={verificationUrl} style={link}>
            {verificationUrl}
          </Link>
        </Text>

        <Hr style={hr} />

        <Text style={warningText}>
          <strong>Note:</strong> This verification link will expire in 24 hours.
        </Text>

        <Text style={warningText}>
          If you did not request this subscription, you can safely ignore this email.
        </Text>
      </Section>
    </BaseLayout>
  );
};

const contentSection = {
  padding: "32px 32px 0",
};

const paragraph = {
  color: "#374151",
  fontSize: "16px",
  lineHeight: "1.5",
  margin: "0 0 24px",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button = {
  backgroundColor: "#1f2937",
  borderRadius: "6px",
  color: "#fff",
  fontSize: "16px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "14px 32px",
};

const smallText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "24px 0 8px",
  textAlign: "center" as const,
};

const urlText = {
  margin: "0 0 32px",
  textAlign: "center" as const,
};

const link = {
  color: "#1f2937",
  textDecoration: "underline",
  wordBreak: "break-all" as const,
  fontSize: "13px",
};

const hr = {
  borderColor: "#e5e7eb",
  margin: "32px 0 24px",
};

const warningText = {
  color: "#6b7280",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0 0 12px",
};

const footerText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 16px",
};

export default StatusPageVerificationEmail;
