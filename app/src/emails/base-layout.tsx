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
}

export const BaseLayout = ({
  preview,
  title,
  children,
  footer,
  headerColor = "#667eea",
}: BaseLayoutProps) => {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={{ ...header, background: headerColor }}>
            <Heading style={headerTitle}>{title}</Heading>
          </Section>
          <Section style={content}>{children}</Section>
          <Section style={footerSection}>
            {footer || (
              <>
                <Text style={footerText}>
                  This email was sent by Supercheck - Automation & Monitoring Platform
                </Text>
                <Text style={footerSmall}>
                  <Link href="https://supercheck.io" style={footerLink}>
                    supercheck.io
                  </Link>
                </Text>
              </>
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

const main = {
  backgroundColor: "#f8fafc",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  padding: "40px 0",
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  maxWidth: "600px",
  borderRadius: "8px",
  overflow: "hidden",
  boxShadow: "0 4px 6px rgba(0, 0, 0, 0.07)",
};

const header = {
  padding: "32px 40px",
  textAlign: "center" as const,
  background: "#667eea",
};

const headerTitle = {
  color: "#ffffff",
  fontSize: "24px",
  fontWeight: "600",
  margin: "0",
};

const content = {
  padding: "40px",
};

const footerSection = {
  padding: "24px 40px",
  textAlign: "center" as const,
  backgroundColor: "#f9fafb",
  borderTop: "1px solid #e5e7eb",
};

const footerText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 8px 0",
};

const footerSmall = {
  color: "#9ca3af",
  fontSize: "12px",
  margin: "0",
};

const footerLink = {
  color: "#667eea",
  textDecoration: "none",
};

export default BaseLayout;
