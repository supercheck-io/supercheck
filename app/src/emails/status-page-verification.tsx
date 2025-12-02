import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface StatusPageVerificationEmailProps {
  verificationUrl: string;
  statusPageName: string;
}

export const StatusPageVerificationEmail = ({
  verificationUrl = "https://supercheck.io/verify?token=abc123",
  statusPageName = "Example Status Page",
}: StatusPageVerificationEmailProps) => {
  return (
    <Html>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
      </Head>
      <Preview>Verify your subscription to {statusPageName}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Heading style={headerTitle}>Verify Your Subscription</Heading>
          </Section>

          {/* Icon */}
          <Section style={iconSection}>
            <div style={iconCircle}>
              <span style={iconText}>✉️</span>
            </div>
          </Section>

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading as="h2" style={heading}>
              Confirm Your Email Address
            </Heading>

            <Text style={paragraph}>
              Thank you for subscribing to status updates for{" "}
              <strong style={highlight}>{statusPageName}</strong>.
            </Text>

            <Text style={paragraph}>
              To complete your subscription and start receiving real-time
              notifications about service incidents, scheduled maintenance, and
              status updates, please verify your email address by clicking the
              button below.
            </Text>
          </Section>

          {/* CTA Button */}
          <Section style={buttonSection}>
            <Button style={ctaButton} href={verificationUrl}>
              Verify Email Address
            </Button>
          </Section>

          {/* Alternative Link */}
          <Section style={contentSection}>
            <Text style={alternativeText}>
              Or copy and paste this link into your browser:
            </Text>
            <table style={urlBox} cellPadding="0" cellSpacing="0">
              <tbody>
                <tr>
                  <td style={{ padding: "12px 16px" }}>
                    <Link href={verificationUrl} style={urlLink}>
                      {verificationUrl}
                    </Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Hr style={divider} />

          {/* Notice Box */}
          <Section style={contentSection}>
            <table style={noticeBox} cellPadding="0" cellSpacing="0">
              <tbody>
                <tr>
                  <td style={{ padding: "16px 20px" }}>
                    <Text style={noticeTitle}>⏰ Link expires in 24 hours</Text>
                    <Text style={noticeText}>
                      If you didn&apos;t request this subscription, you can
                      safely ignore this email.
                    </Text>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          {/* Spacer */}
          <Section style={{ height: "24px" }} />

          <Hr style={footerDivider} />

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              This email was sent because someone subscribed to status updates
              for {statusPageName}.
            </Text>
            <Text style={copyright}>
              Powered by{" "}
              <Link href="https://supercheck.io" style={footerLink}>
                Supercheck
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const main = {
  backgroundColor: "#f4f4f5",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  padding: "40px 20px",
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  maxWidth: "560px",
  borderRadius: "12px",
  overflow: "hidden" as const,
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
};

const header = {
  backgroundColor: "#3b82f6",
  padding: "28px 32px",
  textAlign: "center" as const,
};

const headerTitle = {
  color: "#ffffff",
  fontSize: "20px",
  fontWeight: "600" as const,
  margin: "0",
  letterSpacing: "-0.01em",
};

const iconSection = {
  textAlign: "center" as const,
  padding: "32px 32px 0",
};

const iconCircle = {
  display: "inline-block",
  backgroundColor: "#eff6ff",
  borderRadius: "50%",
  width: "64px",
  height: "64px",
  lineHeight: "64px",
  textAlign: "center" as const,
};

const iconText = {
  fontSize: "28px",
};

const contentSection = {
  padding: "0 32px",
};

const heading = {
  color: "#18181b",
  fontSize: "22px",
  fontWeight: "700" as const,
  margin: "24px 0 16px",
  lineHeight: "1.3",
  letterSpacing: "-0.02em",
  textAlign: "center" as const,
};

const paragraph = {
  color: "#52525b",
  fontSize: "15px",
  lineHeight: "1.65",
  margin: "0 0 16px",
  textAlign: "center" as const,
};

const highlight = {
  color: "#18181b",
  fontWeight: "600" as const,
};

const buttonSection = {
  textAlign: "center" as const,
  padding: "16px 32px 32px",
};

const ctaButton = {
  backgroundColor: "#3b82f6",
  borderRadius: "8px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "600" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "14px 32px",
};

const alternativeText = {
  color: "#71717a",
  fontSize: "13px",
  margin: "0 0 12px",
  textAlign: "center" as const,
};

const urlBox = {
  width: "100%",
  backgroundColor: "#fafafa",
  border: "1px solid #e4e4e7",
  borderRadius: "8px",
  marginBottom: "24px",
};

const urlLink = {
  color: "#3b82f6",
  textDecoration: "none",
  wordBreak: "break-all" as const,
  fontSize: "13px",
  fontWeight: "500" as const,
};

const divider = {
  borderColor: "#e4e4e7",
  margin: "0 32px",
};

const noticeBox = {
  width: "100%",
  backgroundColor: "#fefce8",
  border: "1px solid #fde047",
  borderRadius: "8px",
  marginTop: "24px",
};

const noticeTitle = {
  color: "#854d0e",
  fontSize: "14px",
  fontWeight: "600" as const,
  margin: "0 0 4px",
  textAlign: "center" as const,
};

const noticeText = {
  color: "#a16207",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0",
  textAlign: "center" as const,
};

const footerDivider = {
  borderColor: "#e4e4e7",
  margin: "0",
};

const footer = {
  padding: "24px 32px",
  backgroundColor: "#fafafa",
};

const footerText = {
  color: "#71717a",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 12px",
  textAlign: "center" as const,
};

const footerLink = {
  color: "#52525b",
  textDecoration: "underline",
};

const copyright = {
  color: "#a1a1aa",
  fontSize: "12px",
  margin: "0",
  textAlign: "center" as const,
};

export default StatusPageVerificationEmail;
