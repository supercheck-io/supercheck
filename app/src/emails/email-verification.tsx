import { Button, Hr, Link, Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout } from "./base-layout";

interface EmailVerificationEmailProps {
  verificationUrl: string;
  userEmail: string;
  userName?: string;
}

export const EmailVerificationEmail = ({
  verificationUrl = "https://supercheck.io/verify-email?token=abc123",
  userEmail = "user@example.com",
  userName = "User",
}: EmailVerificationEmailProps) => {
  return (
    <BaseLayout
      preview="Verify your email address to complete signup"
      title="Email Verification"
      headerColor="#059669" // Emerald-600
    >
      <Section style={contentSection}>
        {/* Main Content */}
        <Text style={heading}>Verify Your Email</Text>

        <Text style={paragraph}>Hi {userName},</Text>

        <Text style={paragraph}>
          Thanks for signing up for Supercheck! Please verify your email address
          to complete your registration:
        </Text>

        <Text style={emailHighlight}>{userEmail}</Text>

        {/* CTA Button */}
        <Section style={buttonContainer}>
          <Button style={button} href={verificationUrl}>
            Verify Email Address
          </Button>
        </Section>

        {/* Alternative Link */}
        <Text style={smallText}>
          Or copy and paste this URL into your browser:
        </Text>
        <Text style={urlText}>
          <Link href={verificationUrl} style={link}>
            {verificationUrl}
          </Link>
        </Text>

        <Hr style={hr} />

        {/* Info Notice */}
        <Section style={infoBox}>
          <Text style={infoTitle}>Why verify?</Text>
          <Text style={infoText}>
            Email verification helps us ensure the security of your account and
            enables important features like password recovery.
          </Text>
          <Text style={infoText}>
            If you didn&apos;t create an account with Supercheck, you can safely
            ignore this email.
          </Text>
        </Section>
      </Section>
    </BaseLayout>
  );
};

// ============================================================================
// TEXT STYLES
// ============================================================================

const contentSection = {
  padding: "32px 32px 0",
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
  margin: "0 0 16px",
};

const emailHighlight = {
  backgroundColor: "#f3f4f6",
  borderRadius: "6px",
  color: "#111827",
  display: "block",
  fontFamily: "monospace",
  fontSize: "14px",
  margin: "16px 0 24px",
  padding: "12px 16px",
  textAlign: "center" as const,
};

// ============================================================================
// BUTTON STYLES
// ============================================================================

const buttonContainer = {
  textAlign: "center" as const,
  margin: "24px 0",
};

const button = {
  backgroundColor: "#059669",
  borderRadius: "8px",
  color: "#ffffff",
  display: "inline-block",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
  fontSize: "15px",
  fontWeight: "600" as const,
  lineHeight: "1",
  padding: "14px 28px",
  textDecoration: "none",
  textAlign: "center" as const,
};

// ============================================================================
// LINK STYLES
// ============================================================================

const smallText = {
  color: "#6b7280",
  fontSize: "12px",
  lineHeight: "1.5",
  margin: "16px 0 8px",
  textAlign: "center" as const,
};

const urlText = {
  fontSize: "12px",
  lineHeight: "1.5",
  margin: "0 0 24px",
  textAlign: "center" as const,
  wordBreak: "break-all" as const,
};

const link = {
  color: "#059669",
  textDecoration: "underline",
};

// ============================================================================
// DIVIDER STYLES
// ============================================================================

const hr = {
  borderColor: "#e5e7eb",
  margin: "24px 0",
};

// ============================================================================
// INFO BOX STYLES
// ============================================================================

const infoBox = {
  backgroundColor: "#ecfdf5",
  borderRadius: "8px",
  border: "1px solid #a7f3d0",
  margin: "0 0 24px",
  padding: "16px",
};

const infoTitle = {
  color: "#065f46",
  fontSize: "13px",
  fontWeight: "600" as const,
  lineHeight: "1.4",
  margin: "0 0 8px",
};

const infoText = {
  color: "#047857",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 8px",
};

export default EmailVerificationEmail;
