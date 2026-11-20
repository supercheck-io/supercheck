import {
  Heading,
  Hr,
  Link,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { PALETTE } from "./palette";
import { BaseLayout, EmailButton } from "./base-layout";
import { getTranslations } from "../lib/status-page-translations";

interface StatusPageVerificationEmailProps {
  verificationUrl: string;
  statusPageName: string;
  language?: string;
}

export const StatusPageVerificationEmail = ({
  verificationUrl = "https://supercheck.io/verify?token=abc123",
  statusPageName = "Example Status Page",
  language = "en",
}: StatusPageVerificationEmailProps) => {
  const t = getTranslations(language);

  return (
    <BaseLayout
      preview={`${t.emailSubjectVerify} ${statusPageName}`}
      title={t.emailVerifySubscription}
      lang={language}
      showBrand={false}
      showStandardFooter={false}
      footer={
        <>
            <Text style={footerText}>
              {t.emailVerifySentNotice} {statusPageName}.
            </Text>
            <Text style={copyright}>
              {t.poweredBy}{" "}
              <Link href="https://supercheck.io" style={footerLink}>
                Supercheck
              </Link>
            </Text>
          </>
      }
    >

          {/* Icon */}
          <Section style={iconSection}>
            <div style={iconCircle}>
              <span style={iconText}>✉️</span>
            </div>
          </Section>

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading as="h2" style={heading}>
              {t.emailConfirmAddress}
            </Heading>

            <Text style={paragraph}>
              {t.emailVerifyThankYou}{" "}
              <strong style={highlight}>{statusPageName}</strong>.
            </Text>

            <Text style={paragraph}>
              {t.emailVerifyInstructions}
            </Text>
          </Section>

          {/* CTA Button */}
          <Section style={buttonSection}>
            <EmailButton href={verificationUrl}>{t.emailVerifyButton}</EmailButton>
          </Section>

          {/* Alternative Link */}
          <Section style={contentSection}>
            <Text style={alternativeText}>
              {t.emailVerifyAlternative}
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
                    <Text style={noticeTitle}>⏰ {t.emailVerifyExpiry}</Text>
                    <Text style={noticeText}>
                      {t.emailVerifyIgnore}
                    </Text>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          {/* Spacer */}
          <Section style={{ height: "24px" }} />


          </BaseLayout>
  );
};





const iconSection = {
  textAlign: "center" as const,
  padding: "32px 32px 0",
};

const iconCircle = {
  display: "inline-block",
  backgroundColor: "#f3f4f6",
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
  color: "#111827",
  fontSize: "22px",
  fontWeight: "700" as const,
  margin: "24px 0 16px",
  lineHeight: "1.3",
  letterSpacing: "-0.02em",
};

const paragraph = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.65",
  margin: "0 0 16px",
};

const highlight = {
  color: "#111827",
  fontWeight: "600" as const,
};

const buttonSection = {
  textAlign: "center" as const,
  padding: "16px 32px 32px",
};

const alternativeText = {
  color: "#6b7280",
  fontSize: "13px",
  margin: "0 0 12px",
  textAlign: "center" as const,
};

const urlBox = {
  width: "100%",
  backgroundColor: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  marginBottom: "24px",
};

const urlLink = {
  color: PALETTE.info,
  textDecoration: "none",
  wordBreak: "break-all" as const,
  fontSize: "13px",
  fontWeight: "500" as const,
};

const divider = {
  borderColor: "#e5e7eb",
  margin: "0 32px",
};

const noticeBox = {
  width: "100%",
  backgroundColor: "#fffbeb",
  border: "1px solid #fde68a",
  borderRadius: "8px",
  marginTop: "24px",
};

const noticeTitle = {
  color: "#92400e",
  fontSize: "14px",
  fontWeight: "600" as const,
  margin: "0 0 4px",
};

const noticeText = {
  color: "#78350f",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0",
};



const footerText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 12px",
  textAlign: "center" as const,
};

const footerLink = {
  color: "#4b5563",
  textDecoration: "underline",
};

const copyright = {
  color: "#9ca3af",
  fontSize: "12px",
  margin: "0",
  textAlign: "center" as const,
};

export default StatusPageVerificationEmail;
