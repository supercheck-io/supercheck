import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface BaseLayoutProps {
  preview: string;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerColor?: string;
  showLogo?: boolean;
}

/**
 * Supercheck Logo Component
 * Using text-based logo for Gmail compatibility (Gmail doesn't support SVG)
 * Green checkmark using Unicode character
 */
const SupercheckLogo = () => (
  <div style={logoContainer}>
    <span style={logoCheckmark}>✓</span>
    <span style={logoText}>Supercheck</span>
  </div>
);

export const BaseLayout = ({
  preview,
  title,
  children,
  footer,
  headerColor = "#4a5568",
  showLogo = true,
}: BaseLayoutProps) => {
  return (
    <Html>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header with Logo */}
          <Section style={{ ...header, background: headerColor }}>
            {showLogo && <SupercheckLogo />}
            <Heading style={headerTitle}>{title}</Heading>
          </Section>

          {/* Main Content */}
          <Section style={content}>{children}</Section>

          {/* Footer */}
          <Section style={footerSection}>
            {footer || (
              <>
                <Text style={footerText}>
                  This email was sent by Supercheck
                </Text>
                <Text style={footerSmall}>
                  Automation & Monitoring Platform
                </Text>
                <Text style={footerSmall}>
                  <Link href="https://supercheck.io" style={footerLink}>
                    supercheck.io
                  </Link>
                  {" • "}
                  <Link href="https://docs.supercheck.io" style={footerLink}>
                    Documentation
                  </Link>
                </Text>
              </>
            )}
          </Section>
        </Container>

        {/* Spacer for bottom padding */}
        <Section style={bottomSpacer} />
      </Body>
    </Html>
  );
};

// ============================================================================
// MAIN STYLES
// ============================================================================

const main = {
  backgroundColor: "#f3f4f6",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, Arial, sans-serif',
  padding: "20px 0",
  WebkitFontSmoothing: "antialiased" as const,
  MozOsxFontSmoothing: "grayscale" as const,
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  maxWidth: "600px",
  borderRadius: "12px",
  overflow: "hidden",
  boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
};

// ============================================================================
// HEADER STYLES
// ============================================================================

const header = {
  padding: "32px 32px 28px",
  textAlign: "center" as const,
  background: "#1f2937",
};

const logoContainer = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: "12px",
};

const logoCheckmark = {
  color: "#50b748",
  fontSize: "28px",
  fontWeight: "700",
  marginRight: "8px",
  lineHeight: "1",
  display: "inline-block",
};

const logoText = {
  color: "#ffffff",
  fontSize: "20px",
  fontWeight: "600",
  letterSpacing: "-0.3px",
};

const headerTitle = {
  color: "#e5e7eb",
  fontSize: "18px",
  fontWeight: "500",
  margin: "0",
  lineHeight: "1.4",
};

// ============================================================================
// CONTENT STYLES
// ============================================================================

const content = {
  padding: "40px 32px",
};

// ============================================================================
// FOOTER STYLES
// ============================================================================

const footerSection = {
  padding: "32px",
  textAlign: "center" as const,
  backgroundColor: "#f9fafb",
  borderTop: "1px solid #e5e7eb",
};

const footerText = {
  color: "#6b7280",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0 0 4px 0",
  fontWeight: "500" as const,
};

const footerSmall = {
  color: "#9ca3af",
  fontSize: "12px",
  margin: "4px 0 0 0",
  lineHeight: "1.5",
};

const footerLink = {
  color: "#1f2937",
  textDecoration: "none",
  fontWeight: "500" as const,
};

const bottomSpacer = {
  height: "20px",
};

export default BaseLayout;
