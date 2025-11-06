import {
  Button,
  Hr,
  Link,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { BaseLayout } from "./base-layout";

interface PasswordResetEmailProps {
  resetUrl: string;
  userEmail: string;
}

export const PasswordResetEmail = ({
  resetUrl = "https://supercheck.io/reset-password?token=abc123",
  userEmail = "user@example.com",
}: PasswordResetEmailProps) => {
  return (
    <BaseLayout
      preview="Reset your Supercheck password"
      title="Password Reset Request"
    >
      {/* Main Content */}
      <Text style={heading}>Reset Your Password</Text>

      <Text style={paragraph}>
        You requested a password reset for your Supercheck account:
      </Text>

      <Text style={emailHighlight}>{userEmail}</Text>

      <Text style={paragraph}>
        Click the button below to create a new password:
      </Text>

      {/* CTA Button */}
      <Section style={buttonContainer}>
        <Button style={button} href={resetUrl}>
          Reset Password
        </Button>
      </Section>

      {/* Alternative Link */}
      <Text style={smallText}>
        Or copy and paste this URL into your browser:
      </Text>
      <Text style={urlText}>
        <Link href={resetUrl} style={link}>
          {resetUrl}
        </Link>
      </Text>

      <Hr style={hr} />

      {/* Security Notice */}
      <Section style={warningBox}>
        <Text style={warningTitle}>Security Notice</Text>
        <Text style={warningText}>
          This link will expire in <strong>1 hour</strong> for security reasons.
        </Text>
        <Text style={warningText}>
          If you didn&apos;t request this reset, please ignore this email. Your
          password will remain unchanged.
        </Text>
      </Section>
    </BaseLayout>
  );
};

// ============================================================================
// TEXT STYLES
// ============================================================================

const heading = {
  color: "#111827",
  fontSize: "24px",
  fontWeight: "700" as const,
  lineHeight: "1.3",
  margin: "0 0 24px",
  textAlign: "center" as const,
};

const paragraph = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const emailHighlight = {
  color: "#111827",
  fontSize: "16px",
  fontWeight: "600" as const,
  padding: "12px 20px",
  backgroundColor: "#f3f4f6",
  borderRadius: "8px",
  margin: "0 0 24px",
  textAlign: "center" as const,
  display: "block",
};

// ============================================================================
// BUTTON STYLES
// ============================================================================

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button = {
  backgroundColor: "#1f2937",
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
// LINK STYLES
// ============================================================================

const smallText = {
  color: "#9ca3af",
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
  margin: "32px 0",
};

// ============================================================================
// WARNING BOX STYLES
// ============================================================================

const warningBox = {
  backgroundColor: "#fef3c7",
  borderLeft: "4px solid #f59e0b",
  borderRadius: "8px",
  padding: "20px 24px",
  margin: "0",
};

const warningTitle = {
  color: "#92400e",
  fontSize: "14px",
  fontWeight: "700" as const,
  margin: "0 0 12px",
};

const warningText = {
  color: "#78350f",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0 0 8px",
};

export default PasswordResetEmail;
