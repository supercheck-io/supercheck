import { Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout, Callout, EmailButton, FallbackLink } from "./base-layout";

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
      title="Reset your password"
      reason="You received this because a password reset was requested for this address."
    >
      <Section style={contentSection}>
        <Text style={paragraph}>
          Someone asked to reset the password for the Supercheck account <strong style={strong}>{userEmail}</strong>.
          Choose a new password with the button below.
        </Text>

        <Section style={buttonContainer}>
          <EmailButton href={resetUrl}>Reset password</EmailButton>
        </Section>

        <FallbackLink href={resetUrl} />

        <Callout
          tone="warning"
          title="This link expires in 1 hour"
          lines={["If you did not ask for this, you can ignore this email. Your password stays the same."]}
        />
      </Section>
    </BaseLayout>
  );
};

const contentSection = {
  padding: "32px",
};

const paragraph = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const strong = {
  color: "#111827",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "24px 0",
};

export default PasswordResetEmail;
