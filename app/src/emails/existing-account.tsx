import { Link, Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout, Callout, EmailButton } from "./base-layout";

interface ExistingAccountEmailProps {
  signInUrl: string;
  resetUrl: string;
  userEmail: string;
}

export const ExistingAccountEmail = ({
  signInUrl = "https://supercheck.io/sign-in",
  resetUrl = "https://supercheck.io/forgot-password",
  userEmail = "user@example.com",
}: ExistingAccountEmailProps) => (
  <BaseLayout
    preview="Someone tried to sign up with this address. Sign in to your existing account."
    title="You already have an account"
    reason="You received this because someone tried to sign up for Supercheck with this address."
  >
    <Section style={contentSection}>
      <Text style={paragraph}>
        A sign-up was started with <strong style={strong}>{userEmail}</strong>, but a Supercheck account already exists
        for this address.
      </Text>
      <Text style={paragraph}>
        Sign in to continue. If you use Google or GitHub, choose that option on the sign-in page. Forgot your password?{" "}
        <Link href={resetUrl} style={link}>
          Reset it
        </Link>
        .
      </Text>
      <Section style={buttonContainer}>
        <EmailButton href={signInUrl}>Sign in</EmailButton>
      </Section>
      <Callout tone="neutral" lines={["If this wasn't you, you can ignore this email. Your account is unchanged."]} />
    </Section>
  </BaseLayout>
);

const contentSection = { padding: "32px" };
const paragraph = { color: "#4b5563", fontSize: "15px", lineHeight: "1.6", margin: "0 0 16px" };
const strong = { color: "#111827" };
const buttonContainer = { textAlign: "center" as const, margin: "24px 0" };
const link = { color: "#1d4ed8", textDecoration: "underline" };

export default ExistingAccountEmail;
