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
      title="Reset Your Password"
      headerColor="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
    >
      <Text style={paragraph}>
        You requested a password reset for your Supercheck account (<strong>{userEmail}</strong>).
      </Text>

      <Text style={paragraph}>
        Click the button below to reset your password:
      </Text>

      <Section style={buttonContainer}>
        <Button style={button} href={resetUrl}>
          Reset Password
        </Button>
      </Section>

      <Text style={smallText}>
        Or copy and paste this URL into your browser:
        <br />
        <Link href={resetUrl} style={link}>
          {resetUrl}
        </Link>
      </Text>

      <Hr style={hr} />

      <Text style={warningText}>
        <strong>Important:</strong> This link will expire in 1 hour for security reasons.
      </Text>

      <Text style={warningText}>
        If you didn&apos;t request this reset, please ignore this email. Your password will remain unchanged.
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

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button = {
  backgroundColor: "#667eea",
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
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "24px 0 0",
};

const link = {
  color: "#667eea",
  textDecoration: "none",
  wordBreak: "break-all" as const,
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

export default PasswordResetEmail;
