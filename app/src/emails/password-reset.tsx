import {
  Hr,
  Link,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { BaseLayout, Callout, EmailButton } from "./base-layout";

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
      preview="Use this link within 1 hour to choose a new password."
      title="Password Reset Request"
    >
      <Section style={contentSection}>
        {/* Main Content */}
        <Text style={paragraph}>
          You requested a password reset for your Supercheck account:
        </Text>

        <Text style={emailHighlight}>{userEmail}</Text>

        <Text style={paragraph}>
          Click the button below to create a new password:
        </Text>

        {/* CTA Button */}
        <Section style={buttonContainer}>
          <EmailButton href={resetUrl}>Reset Password</EmailButton>
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
        <Callout
          tone="warning"
          title="Security Notice"
          lines={[
            <>This link will expire in <strong>1 hour</strong> for security reasons.</>,
            "If you didn't request this reset, please ignore this email. Your password will remain unchanged.",
          ]}
        />
      </Section>
    </BaseLayout>
  );
};

// ============================================================================
// TEXT STYLES
// ============================================================================

const contentSection = {
  padding: "32px",
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

export default PasswordResetEmail;
