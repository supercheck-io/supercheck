import {
  Body,
  Button,
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
  /** Header wordmark; false for status-page emails, which carry the customer's page name. */
  showBrand?: boolean;
}

export const BaseLayout = ({
  preview,
  title,
  children,
  footer,
  headerColor = "#15803d",
  showStandardFooter = true,
  showBrand = true,
}: BaseLayoutProps) => {
  const headerText = readableTextColor(headerColor);
  return (
    <Html>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        {/* Light-only: our palette is fixed, so stop clients from auto-inverting it badly. */}
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <style>{`@media only screen and (max-width: 620px) { .sc-container { width: 100% !important; border-radius: 0 !important; } }`}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container className="sc-container" style={container}>
          {/* Header */}
          <Section style={{ ...header, background: headerColor }}>
            {showBrand && <Text style={{ ...brand, color: headerText }}>Supercheck</Text>}
            <Heading style={{ ...headerTitle, color: headerText }}>
              {title}
            </Heading>
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
                  <span style={{ color: "#6b7280" }}>
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

const brand = {
  margin: "0 0 8px",
  fontSize: "13px",
  fontWeight: "700" as const,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  opacity: 0.85,
};

const headerTitle = {
  color: "#ffffff",
  fontSize: "22px",
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
  color: "#6b7280",
  fontSize: "12px",
  lineHeight: "1.6",
  margin: "16px 0 0",
};

const footerLink = {
  color: "#4b5563",
  textDecoration: "none",
  fontWeight: "500" as const,
};

const bottomSpacer = {
  height: "20px",
};

/**
 * Shared primary button so every email has the same call to action.
 */
export const EmailButton = ({
  href,
  children,
  background = "#111827",
}: {
  href: string;
  children: React.ReactNode;
  background?: string;
}) => (
  <Button
    href={href}
    style={{
      backgroundColor: background,
      borderRadius: "6px",
      color: readableTextColor(background),
      fontSize: "15px",
      fontWeight: "600",
      textDecoration: "none",
      textAlign: "center",
      display: "inline-block",
      padding: "12px 28px",
    }}
  >
    {children}
  </Button>
);

export interface DetailField {
  title: string;
  value: string;
}

/** Only http(s) values become links; other schemes (javascript:, data:) stay text. */
function isHttpUrl(value: string) {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Shared label/value table so alert and incident emails show details the same way. */
export const DetailsTable = ({
  heading,
  fields,
}: {
  heading: string;
  fields: DetailField[];
}) => (
  <Section style={detailsSection}>
    <Text style={detailsTitle}>{heading}</Text>
    <table style={detailsTable}>
      <tbody>
        {fields.map((field, index) => (
          <tr key={index}>
            <td style={detailsLabelCell}>{field.title}</td>
            <td style={detailsValueCell}>
              {isHttpUrl(field.value) ? (
                <Link href={field.value} style={detailsLink}>
                  {field.value}
                </Link>
              ) : (
                field.value
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </Section>
);

const detailsSection = {
  padding: "0 32px 32px",
};

const detailsTitle = {
  color: "#374151",
  fontSize: "16px",
  fontWeight: "600" as const,
  margin: "0 0 16px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

const detailsTable = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const detailsLabelCell = {
  padding: "12px 16px",
  fontWeight: "600" as const,
  verticalAlign: "top" as const,
  borderBottom: "1px solid #e5e7eb",
  color: "#6b7280",
  fontSize: "14px",
  width: "30%",
  backgroundColor: "#f9fafb",
  textAlign: "left" as const,
};

const detailsValueCell = {
  padding: "12px 16px",
  verticalAlign: "top" as const,
  borderBottom: "1px solid #e5e7eb",
  color: "#111827",
  fontSize: "14px",
  textAlign: "left" as const,
  overflowWrap: "anywhere" as const,
  wordBreak: "break-word" as const,
};

const detailsLink = {
  color: "#2563eb",
  textDecoration: "none",
  fontWeight: "500" as const,
};

/** White or near-black text, whichever has better contrast on `hex` (WCAG luminance). */
function readableTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.179 ? "#111827" : "#ffffff";
}

export default BaseLayout;
