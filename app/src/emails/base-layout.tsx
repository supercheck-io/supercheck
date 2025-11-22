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
  showStandardFooter?: boolean;
}

export const BaseLayout = ({
  preview,
  title,
  children,
  footer,
  headerColor = "#52c41a",
  showStandardFooter = true,
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
          {/* Header */}
          <Section style={{ ...header, background: headerColor }}>
            <Heading style={headerTitle}>{title}</Heading>
          </Section>

          {/* Main Content */}
          <Section style={content}>{children}</Section>

          {/* Footer */}
          {(footer || showStandardFooter) && (
            <Section style={footerSection}>
              {footer}
              {showStandardFooter && (
                <Text style={standardFooterText}>
                  <Link href="https://supercheck.io" style={footerLink}>
                    Supercheck
                  </Link>
                  {" • "}
                  <Link href="https://supercheck.io/privacy" style={footerLink}>
                    Privacy Policy
                  </Link>
                  {" • "}
                  <Link href="https://supercheck.io/terms" style={footerLink}>
                    Terms of Service
                  </Link>
                  <br />
                  <span style={{ color: "#9ca3af" }}>
                    © {new Date().getFullYear()} Supercheck. All rights reserved.
                  </span>
                </Text>
              )}
            </Section>
          )}
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
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  padding: "20px 0",
  margin: "0",
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  maxWidth: "600px",
  borderRadius: "8px",
  boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
  overflow: "hidden" as const,
};

// ============================================================================
// HEADER STYLES
// ============================================================================

const header = {
  padding: "32px 24px",
  textAlign: "center" as const,
  background: "#52c41a",
};

const headerTitle = {
  color: "#ffffff",
  fontSize: "24px",
  fontWeight: "700" as const,
  margin: "0",
  lineHeight: "1.3",
  letterSpacing: "-0.025em",
};

// ============================================================================
// CONTENT STYLES
// ============================================================================

const content = {
  padding: "0",
};

// ============================================================================
// FOOTER STYLES
// ============================================================================

const footerSection = {
  padding: "32px 24px",
  textAlign: "center" as const,
  backgroundColor: "#f9fafb",
  borderTop: "1px solid #e5e7eb",
};

const standardFooterText = {
  color: "#9ca3af",
  fontSize: "12px",
  lineHeight: "1.6",
  margin: "16px 0 0",
};

const footerLink = {
  color: "#6b7280",
  textDecoration: "none",
  fontWeight: "500" as const,
};

const bottomSpacer = {
  height: "20px",
};

export default BaseLayout;
