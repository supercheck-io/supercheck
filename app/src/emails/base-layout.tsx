import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
} from "@react-email/components";
import * as React from "react";

interface BaseLayoutProps {
  preview: string;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerColor?: string;
}

export const BaseLayout = ({
  preview,
  title,
  children,
  footer,
  headerColor = "#52c41a",
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
          {footer && (
            <Section style={footerSection}>
              {footer}
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
  backgroundColor: "#f5f5f5",
  fontFamily:
    'Arial, Helvetica, sans-serif',
  padding: "0",
  margin: "0",
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  maxWidth: "600px",
  border: "1px solid #e0e0e0",
};

// ============================================================================
// HEADER STYLES
// ============================================================================

const header = {
  padding: "40px 30px",
  textAlign: "center" as const,
  background: "#52c41a",
};

const headerTitle = {
  color: "#ffffff",
  fontSize: "24px",
  fontWeight: "normal" as const,
  margin: "0",
  lineHeight: "1.4",
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
  padding: "20px 30px",
  textAlign: "left" as const,
  backgroundColor: "#ffffff",
  borderTop: "1px solid #e0e0e0",
};

const bottomSpacer = {
  height: "0",
};

export default BaseLayout;
