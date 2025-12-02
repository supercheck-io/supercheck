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

interface StatusPageWelcomeEmailProps {
  statusPageName: string;
  statusPageUrl: string;
  unsubscribeUrl: string;
}

export const StatusPageWelcomeEmail = ({
  statusPageName = "Example Status Page",
  statusPageUrl = "https://example.supercheck.io",
  unsubscribeUrl = "https://example.supercheck.io/unsubscribe?token=abc123",
}: StatusPageWelcomeEmailProps) => {
  return (
    <Html>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
      </Head>
      <Preview>You&apos;re now subscribed to {statusPageName}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Heading style={headerTitle}>Subscription Confirmed</Heading>
          </Section>

          {/* Success Icon */}
          <Section style={iconSection}>
            <div style={iconCircle}>
              <span style={iconText}>✓</span>
            </div>
          </Section>

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading as="h2" style={heading}>
              You&apos;re All Set!
            </Heading>

            <Text style={paragraph}>
              Your subscription to{" "}
              <strong style={highlight}>{statusPageName}</strong> has been
              confirmed successfully. You will now receive real-time
              notifications about any service disruptions, incidents, and
              scheduled maintenance.
            </Text>
          </Section>

          {/* Success Box */}
          <Section style={contentSection}>
            <table style={successBox} cellPadding="0" cellSpacing="0">
              <tbody>
                <tr>
                  <td style={{ padding: "20px 24px" }}>
                    <Text style={successTitle}>🎉 What happens next?</Text>
                    <Text style={successText}>
                      You&apos;ll receive email notifications whenever there are
                      updates to the services you care about.
                    </Text>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          {/* Notification Types Box */}
          <Section style={contentSection}>
            <table style={infoBox} cellPadding="0" cellSpacing="0">
              <tbody>
                <tr>
                  <td style={{ padding: "20px 24px" }}>
                    <Text style={infoTitle}>
                      You&apos;ll receive notifications for:
                    </Text>
                    <Text style={listItem}>
                      • Service incidents and outages
                    </Text>
                    <Text style={listItem}>
                      • Scheduled maintenance windows
                    </Text>
                    <Text style={listItem}>
                      • Incident updates and resolutions
                    </Text>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          {/* CTA Button */}
          <Section style={buttonSection}>
            <Button style={ctaButton} href={statusPageUrl}>
              View Status Page
            </Button>
          </Section>

          <Hr style={divider} />

          {/* Pro Tip */}
          <Section style={contentSection}>
            <table style={tipBox} cellPadding="0" cellSpacing="0">
              <tbody>
                <tr>
                  <td style={{ padding: "16px 20px" }}>
                    <Text style={tipText}>
                      <strong>💡 Pro tip:</strong> Add our email address to your
                      contacts to ensure you never miss an important update.
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
              You&apos;re now subscribed to status updates for {statusPageName}.
            </Text>
            <Text style={footerLinks}>
              <Link href={statusPageUrl} style={footerLink}>
                View Status Page
              </Link>
              {" • "}
              <Link href={unsubscribeUrl} style={footerLink}>
                Unsubscribe
              </Link>
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
  backgroundColor: "#16a34a",
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
  backgroundColor: "#dcfce7",
  borderRadius: "50%",
  width: "64px",
  height: "64px",
  lineHeight: "64px",
  textAlign: "center" as const,
};

const iconText = {
  color: "#16a34a",
  fontSize: "32px",
  fontWeight: "700" as const,
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
  margin: "0 0 24px",
  textAlign: "center" as const,
};

const highlight = {
  color: "#18181b",
  fontWeight: "600" as const,
};

const successBox = {
  width: "100%",
  backgroundColor: "#f0fdf4",
  border: "1px solid #bbf7d0",
  borderRadius: "8px",
  marginBottom: "16px",
};

const successTitle = {
  color: "#166534",
  fontSize: "15px",
  fontWeight: "600" as const,
  margin: "0 0 8px",
  textAlign: "center" as const,
};

const successText = {
  color: "#15803d",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0",
  textAlign: "center" as const,
};

const infoBox = {
  width: "100%",
  backgroundColor: "#fafafa",
  border: "1px solid #e4e4e7",
  borderRadius: "8px",
  marginBottom: "24px",
};

const infoTitle = {
  color: "#3f3f46",
  fontSize: "14px",
  fontWeight: "600" as const,
  margin: "0 0 12px",
};

const listItem = {
  color: "#52525b",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0 0 4px",
};

const buttonSection = {
  textAlign: "center" as const,
  padding: "8px 32px 32px",
};

const ctaButton = {
  backgroundColor: "#16a34a",
  borderRadius: "8px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "600" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "14px 32px",
};

const divider = {
  borderColor: "#e4e4e7",
  margin: "0 32px",
};

const tipBox = {
  width: "100%",
  backgroundColor: "#eff6ff",
  border: "1px solid #bfdbfe",
  borderRadius: "8px",
  marginTop: "24px",
};

const tipText = {
  color: "#1e40af",
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

const footerLinks = {
  color: "#71717a",
  fontSize: "13px",
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

export default StatusPageWelcomeEmail;
