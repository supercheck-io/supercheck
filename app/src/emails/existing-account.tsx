import { Hr, Link, Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout, EmailButton } from "./base-layout";

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
  >
    <Section style={contentSection}>
      <Text style={paragraph}>
        A sign-up was started with <strong>{userEmail}</strong>, but a Supercheck account already exists for this address.
      </Text>
      <Text style={paragraph}>
        Sign in to continue. If you use Google or GitHub, choose that option on the sign-in page.
      </Text>
      <Section style={buttonContainer}>
        <EmailButton href={signInUrl}>Sign in</EmailButton>
      </Section>
      <Text style={smallText}>
        Forgot your password? <Link href={resetUrl} style={link}>Reset it</Link>.
      </Text>
      <Hr style={hr} />
      <Text style={smallText}>If this wasn&apos;t you, you can ignore this email. Your account is unchanged.</Text>
    </Section>
  </BaseLayout>
);

const contentSection = { padding: "32px" };
const paragraph = { color: "#4b5563", fontSize: "15px", lineHeight: "1.6", margin: "0 0 16px" };
const buttonContainer = { textAlign: "center" as const, margin: "32px 0" };
const smallText = { color: "#6b7280", fontSize: "13px", lineHeight: "1.5", margin: "0 0 8px", textAlign: "center" as const };
const link = { color: "#1f2937", textDecoration: "underline" };
const hr = { borderColor: "#e5e7eb", margin: "24px 0" };

export default ExistingAccountEmail;
