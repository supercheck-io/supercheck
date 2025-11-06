import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
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
 * Professional Supercheck Logo Component
 * Using SVG for crisp display across all email clients
 */
const SupercheckLogo = () => (
  <div style={logoContainer}>
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <rect width="40" height="40" rx="8" fill="white" fillOpacity="0.2" />
      <path
        d="M12 20L18 26L28 14"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
    <span style={logoText}>Supercheck</span>
  </div>
);

export const BaseLayout = ({
  preview,
  title,
  children,
  footer,
  headerColor = "#667eea",
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
  padding: "40px 32px 32px",
  textAlign: "center" as const,
  background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
};

const logoContainer = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "12px",
  marginBottom: "16px",
};

const logoText = {
  color: "#ffffff",
  fontSize: "24px",
  fontWeight: "700",
  letterSpacing: "-0.5px",
};

const headerTitle = {
  color: "#ffffff",
  fontSize: "22px",
  fontWeight: "600",
  margin: "0",
  lineHeight: "1.3",
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
  color: "#667eea",
  textDecoration: "none",
  fontWeight: "500" as const,
};

const bottomSpacer = {
  height: "20px",
};

export default BaseLayout;
