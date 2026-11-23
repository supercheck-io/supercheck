import {
  Body,
  Button,
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
import { plainTextSelectors } from "@react-email/render";
import * as React from "react";
import { PALETTE, TONES, type PaletteTone } from "./palette";

interface BaseLayoutProps {
  preview: string;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  showStandardFooter?: boolean;
  /** Supercheck logo and wordmark in the header; false for status-page emails, which are the customer's brand. */
  showBrand?: boolean;
  /** Customer logo (absolute URL) shown in the header instead of the Supercheck lockup, when showBrand is false. */
  headerLogoUrl?: string;
  /** Document language (status-page emails); RTL languages also set dir="rtl". */
  lang?: string;
  /** Why this email was sent, shown above the standard footer links. */
  reason?: string;
  /** Link to where the recipient can change what they receive (notification channels, billing...). */
  manage?: { href: string; label: string };
  /** Public app origin; used for the logo before falling back to the env vars. */
  appUrl?: string;
}

/**
 * Absolute logo URL on this instance's own public app URL (mail clients cannot load
 * relative assets). Without a base URL there is no image, so a self-hosted install
 * never makes recipients' mail clients contact supercheck.io.
 */
export const emailLogoUrl = (env: NodeJS.ProcessEnv = process.env, appUrl?: string): string | undefined => {
  const base = (appUrl || configuredAppUrl(env)).trim();
  try {
    const url = new URL(base);
    return /^https?:$/.test(url.protocol) ? `${url.origin}${url.pathname.replace(/\/+$/, "")}/supercheck-logo.png` : undefined;
  } catch {
    return undefined;
  }
};

const configuredAppUrl = (env: NodeJS.ProcessEnv) => env.NEXT_PUBLIC_APP_URL || env.APP_URL || env.BETTER_AUTH_URL || "";

/**
 * Public app origin for links in emails (no trailing slash): the configured app URL, else the local dev
 * origin the rest of the app falls back to. Every email link is built from this, so none is relative.
 */
export const emailAppUrl = (env: NodeJS.ProcessEnv = process.env): string =>
  (configuredAppUrl(env).trim() || "http://localhost:3000").replace(/\/+$/, "");

/** Same rule as the app's isSelfHosted(): SELF_HOSTED "true" or "1". Self-hosted emails carry no supercheck.io links. */
const isSelfHostedEnv = (env: NodeJS.ProcessEnv = process.env) =>
  ["true", "1"].includes(env.SELF_HOSTED?.trim().toLowerCase() ?? "");

/** "Wed, 18 Nov 2026 06:02:36 UTC": one timestamp format, with an explicit zone, in every email. */
export const formatEmailTime = (date: Date): string =>
  date.toUTCString().replace(/ GMT$/, " UTC");

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);

export const BaseLayout = ({
  preview,
  title,
  children,
  footer,
  showStandardFooter = true,
  showBrand = true,
  headerLogoUrl,
  lang = "en",
  reason,
  manage,
  appUrl,
}: BaseLayoutProps) => {
  const dir = RTL_LANGUAGES.has(lang.toLowerCase().split("-")[0]) ? "rtl" : "ltr";
  const logoUrl = emailLogoUrl(process.env, appUrl);
  return (
    <Html lang={lang} dir={dir}>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        <title>{title}</title>
        {/* Light-only: our palette is fixed, so stop clients from auto-inverting it badly. */}
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <style>{`@media only screen and (max-width: 620px) { .sc-container { width: 100% !important; border-radius: 0 !important; } }`}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container className="sc-container" style={container}>
          {/* Header */}
          <Section style={header}>
            {/* Same lockup as the landing page: logo tile beside the wordmark. A table keeps it on one row in Outlook. */}
            {showBrand && (
              <table role="presentation" cellPadding={0} cellSpacing={0} border={0} align="center" style={brandRow}>
                <tbody>
                  <tr>
                    {logoUrl && (
                      <td style={brandLogoCell}>
                        <Img src={logoUrl} width="28" height="28" alt="" style={logo} />
                      </td>
                    )}
                    <td style={brandTextCell}>
                      <Text style={brand}>Supercheck</Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
            {!showBrand && headerLogoUrl && (
              <Img src={headerLogoUrl} height="40" alt="" style={customLogo} />
            )}
            <Heading style={headerTitle}>{title}</Heading>
          </Section>

          {/* Main Content */}
          <Section style={content}>{children}</Section>

          {/* Footer */}
          {(footer || showStandardFooter || reason) && (
            <Section style={footerSection}>
              {footer}
              {reason && (
                <Text style={reasonText}>
                  {reason}
                  {manage && (
                    <>
                      {" "}
                      <Link href={manage.href} style={reasonLink}>
                        {manage.label}
                      </Link>
                    </>
                  )}
                </Text>
              )}
              {showStandardFooter && !isSelfHostedEnv() && (
                <Text style={standardFooterText}>
                  <Link href="https://supercheck.io" style={footerLink}>
                    Supercheck
                  </Link>
                  {" • "}
                  <Link href="https://supercheck.io/privacy" style={footerLink}>
                    Privacy policy
                  </Link>
                  {" • "}
                  <Link href="https://supercheck.io/terms" style={footerLink}>
                    Terms of service
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
  background: PALETTE.neutral,
};

const logo = {
  display: "block",
  borderRadius: "6px",
};

// Customer logos have any aspect ratio: fixed height, width follows, capped so a wide logo stays in the header.
const customLogo = {
  display: "block",
  margin: "0 auto 14px",
  height: "40px",
  width: "auto",
  maxWidth: "200px",
};

const brandRow = {
  margin: "0 auto 14px",
};

const brandLogoCell = {
  verticalAlign: "middle" as const,
  paddingRight: "10px",
};

const brandTextCell = {
  verticalAlign: "middle" as const,
};

const reasonText = {
  color: "#4b5563",
  fontSize: "12px",
  lineHeight: "1.6",
  margin: "0 0 8px",
};

const reasonLink = {
  color: "#1d4ed8",
  textDecoration: "underline",
};

const brand = {
  color: "#ffffff",
  margin: "0",
  fontSize: "18px",
  fontWeight: "700" as const,
  lineHeight: "28px",
  letterSpacing: "-0.02em",
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
export const EmailButton = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Button
    href={href}
    style={{
      backgroundColor: "#111827",
      borderRadius: "6px",
      color: "#ffffff",
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

/**
 * Footer for public status-page subscriber emails: why it was sent, the page and unsubscribe links,
 * and "Powered by Supercheck". Strings come translated from the caller.
 */
export const SubscriberFooter = ({
  notice,
  links,
  poweredBy,
}: {
  notice: string;
  links: Array<{ href?: string; label: string }>;
  poweredBy: string;
}) => {
  const shown = links.filter((link): link is { href: string; label: string } => Boolean(link.href));
  return (
    <>
      <Text style={reasonText}>{notice}</Text>
      {shown.length > 0 && (
        <Text style={reasonText}>
          {shown.map((link, i) => (
            <React.Fragment key={link.href}>
              {i > 0 && " • "}
              <Link href={link.href} style={reasonLink}>
                {link.label}
              </Link>
            </React.Fragment>
          ))}
        </Text>
      )}
      <Text style={standardFooterText}>
        {poweredBy}{" "}
        <Link href="https://supercheck.io" style={footerLink}>
          Supercheck
        </Link>
      </Text>
    </>
  );
};

/** "Or copy this link" under a button, for clients that block buttons. */
export const FallbackLink = ({ href, label = "If the button does not work, copy this link into your browser:" }: { href: string; label?: string }) => (
  <>
    <Text style={fallbackLabel}>{label}</Text>
    <Text style={fallbackUrl}>
      <Link href={href} style={reasonLink}>
        {href}
      </Link>
    </Text>
  </>
);

const fallbackLabel = { color: "#6b7280", fontSize: "13px", lineHeight: "1.5", margin: "0 0 4px", textAlign: "center" as const };
const fallbackUrl = { fontSize: "13px", lineHeight: "1.5", margin: "0 0 24px", textAlign: "center" as const, wordBreak: "break-all" as const };

/** Footer line for owner-facing billing emails; only rendered when a billing URL exists. */
export const ManageBillingLink = ({ href }: { href?: string }) =>
  href ? (
    <Text style={manageBillingText}>
      <Link href={href} style={footerLink}>
        Manage billing
      </Link>
    </Text>
  ) : null;

const manageBillingText = {
  color: "#6b7280",
  fontSize: "12px",
  margin: "0",
};

/** Small status pill for the body; the only place severity gets colour (never the header). */
export const StatusBadge = ({
  tone = "neutral",
  skipInText = false,
  children,
}: {
  tone?: PaletteTone;
  /** Keep the badge out of the plain-text part (when the same words are already in it). */
  skipInText?: boolean;
  children: React.ReactNode;
}) => (
  <span
    {...(skipInText ? { "data-skip-in-text": "true" } : {})}
    style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: "999px",
      backgroundColor: TONES[tone].bg,
      color: TONES[tone].fg,
      fontSize: "12px",
      fontWeight: "700",
      lineHeight: "1.5",
      letterSpacing: "0.02em",
    }}
  >
    {children}
  </span>
);

const CALLOUT = {
  neutral: { bg: "#f9fafb", border: "#e5e7eb", title: "#111827", text: "#4b5563" },
  note: { bg: "#ecfdf5", border: "#a7f3d0", title: "#065f46", text: "#047857" },
  warning: { bg: "#fffbeb", border: "#fde68a", title: "#92400e", text: "#78350f" },
  danger: { bg: "#fef2f2", border: "#fecaca", title: "#991b1b", text: "#7f1d1d" },
} as const;

/** The "Why verify?" box from the email-verification email: tinted, 1px border, small title + text. */
export const Callout = ({
  tone = "note",
  title,
  lines,
}: {
  tone?: keyof typeof CALLOUT;
  title?: string;
  lines: React.ReactNode[];
}) => {
  const c = CALLOUT[tone];
  return (
    <Section
      style={{ backgroundColor: c.bg, borderRadius: "8px", border: `1px solid ${c.border}`, margin: "0 0 24px", padding: "16px" }}
    >
      {title && (
        <Text style={{ color: c.title, fontSize: "13px", fontWeight: "600", lineHeight: "1.4", margin: "0 0 8px" }}>
          {title}
        </Text>
      )}
      {lines.map((line, i) => (
        <Text
          key={i}
          style={{ color: c.text, fontSize: "13px", lineHeight: "1.5", margin: i === lines.length - 1 ? "0" : "0 0 8px" }}
        >
          {line}
        </Text>
      ))}
    </Section>
  );
};

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
/**
 * Options for the plain-text part. Without them the details table's cells run together
 * ("Job NameRhona McleanStatusSuccess"); render it as aligned columns instead.
 */
export const PLAIN_TEXT_RENDER_OPTIONS = {
  plainText: true as const,
  htmlToTextOptions: {
    // Custom selectors replace react-email's defaults (skip images and preview padding, plain links), so keep them.
    selectors: [
      ...plainTextSelectors,
      { selector: "table.sc-details", format: "dataTable", options: { uppercaseHeaderCells: false } },
      // Layout tables carry no data; keep their text flowing as blocks.
      { selector: "table", format: "block" },
    ],
  },
};

export const DetailsTable = ({
  heading,
  fields,
}: {
  heading: string;
  fields: DetailField[];
}) => (
  <Section style={detailsSection}>
    <Text style={detailsTitle}>{heading}</Text>
    <table className="sc-details" style={detailsTable}>
      <tbody>
        {fields.map((field, index) => (
          <tr key={index}>
            <th scope="row" style={detailsLabelCell}>
              {field.title}
            </th>
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
  whiteSpace: "pre-wrap" as const,
};

const detailsLink = {
  color: "#2563eb",
  textDecoration: "none",
  fontWeight: "500" as const,
};

export default BaseLayout;
