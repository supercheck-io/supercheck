import { Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout, Callout, EmailButton, FallbackLink } from "./base-layout";

interface EmailVerificationEmailProps {
  verificationUrl: string;
  userEmail: string;
  userName?: string;
}

export const EmailVerificationEmail = ({
  verificationUrl = "https://supercheck.io/verify-email?token=abc123",
  userEmail = "user@example.com",
  userName,
}: EmailVerificationEmailProps) => {
  return (
    <BaseLayout
      preview="Confirm this address to finish setting up your Supercheck account. The link expires in 1 hour."
      title="Verify your email address"
      reason="You received this because this address was used to sign up for Supercheck."
    >
      <Section style={contentSection}>
        <Text style={paragraph}>{userName ? `Hi ${userName},` : "Hi,"}</Text>
        <Text style={paragraph}>
          Confirm that <strong style={strong}>{userEmail}</strong> is your email address to finish setting up your
          Supercheck account.
        </Text>

        <Section style={buttonContainer}>
          <EmailButton href={verificationUrl}>Verify email address</EmailButton>
        </Section>

        <FallbackLink href={verificationUrl} />

        <Callout
          tone="warning"
          title="This link expires in 1 hour"
          lines={["If you did not create a Supercheck account, you can ignore this email."]}
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

export default EmailVerificationEmail;
