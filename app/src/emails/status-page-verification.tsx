import { Button, Hr, Link, Section, Text } from "@react-email/components";
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
      headerColor="#3b82f6"
      footer={
        <Text style={footerText}>
          This email was sent because you subscribed to status updates from{" "}
          <strong>{statusPageName}</strong>.
        </Text>
      }
    >
      <Section style={headerSection}>
        <Text style={notificationLabel}>Subscription Request</Text>
      </Section>

      <Section style={contentSection}>
        <Text style={heading}>Confirm Your Email</Text>

        <Text style={paragraph}>
          Thank you for subscribing to{" "}
          <strong style={{ color: "#111827" }}>{statusPageName}</strong> status
          updates!
        </Text>

        <Text style={paragraph}>
          To complete your subscription and start receiving notifications about
          incidents and maintenance, please verify your email address by
          clicking the button below:
        </Text>

        <Section style={buttonContainer}>
          <Button style={button} href={verificationUrl}>
            Verify Email Address
          </Button>
        </Section>

        <Text style={smallText}>
          Or copy and paste this URL into your browser:
        </Text>
        <Section style={urlBox}>
          <Link href={verificationUrl} style={link}>
            {verificationUrl}
          </Link>
        </Section>

        <Hr style={hr} />

        <Section style={noticeBox}>
          <Text style={noticeText}>
            <strong>⏰ This link expires in 24 hours.</strong>
          </Text>
          <Text style={noticeText}>
            If you didn&apos;t request this subscription, you can safely ignore
            this email.
          </Text>
        </Section>
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
  color: "#6b7280",
  fontSize: "12px",
  fontWeight: "600" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  margin: "0 0 8px",
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
  margin: "0 0 20px",
  textAlign: "center" as const,
};

// ============================================================================
// BUTTON STYLES
// ============================================================================

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button = {
  backgroundColor: "#3b82f6",
  borderRadius: "6px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "600" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "14px 36px",
};

// ============================================================================
// URL SECTION STYLES
// ============================================================================

const smallText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "24px 0 12px",
  textAlign: "center" as const,
};

const urlBox = {
  backgroundColor: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "6px",
  padding: "12px 16px",
  margin: "0 0 24px",
  textAlign: "center" as const,
};

const link = {
  color: "#3b82f6",
  textDecoration: "none",
  wordBreak: "break-all" as const,
  fontSize: "13px",
  fontWeight: "500" as const,
};

const hr = {
  borderColor: "#e5e7eb",
  margin: "24px 0",
};

// ============================================================================
// NOTICE BOX STYLES
// ============================================================================

const noticeBox = {
  backgroundColor: "#fffbeb",
  border: "1px solid #fcd34d",
  borderRadius: "8px",
  padding: "16px 20px",
  margin: "0 0 32px",
};

const noticeText = {
  color: "#92400e",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "0 0 4px",
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

export default StatusPageVerificationEmail;
