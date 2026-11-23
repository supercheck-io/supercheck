import { Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout, Callout, EmailButton, FallbackLink, SubscriberFooter } from "./base-layout";
import { getTranslations } from "../lib/status-page-translations";

interface StatusPageVerificationEmailProps {
  /** The status page\'s email logo (absolute URL); the header shows only the page name without it. */
  logoUrl?: string;
  verificationUrl: string;
  statusPageName: string;
  language?: string;
}

export const StatusPageVerificationEmail = ({
  logoUrl,
  verificationUrl = "https://supercheck.io/verify?token=abc123",
  statusPageName = "Example Status Page",
  language = "en",
}: StatusPageVerificationEmailProps) => {
  const t = getTranslations(language);

  return (
    <BaseLayout
      preview={`${t.emailSubjectVerify} ${statusPageName}. ${t.emailVerifyExpiry}.`}
      title={statusPageName}
      lang={language}
      showBrand={false}
      headerLogoUrl={logoUrl}
      showStandardFooter={false}
      footer={
        <SubscriberFooter notice={`${t.emailVerifySentNotice} ${statusPageName}.`} links={[]} poweredBy={t.poweredBy} />
      }
    >
      <Section style={contentSection}>
        <Text style={heading}>{t.emailConfirmAddress}</Text>
        <Text style={paragraph}>
          {t.emailVerifyThankYou} <strong style={highlight}>{statusPageName}</strong>.
        </Text>
      </Section>

      <Section style={buttonSection}>
        <EmailButton href={verificationUrl}>{t.emailVerifyButton}</EmailButton>
      </Section>

      <Section style={contentSection}>
        <FallbackLink href={verificationUrl} label={t.emailVerifyAlternative} />
        <Callout tone="warning" title={t.emailVerifyExpiry} lines={[t.emailVerifyIgnore]} />
      </Section>
    </BaseLayout>
  );
};

const contentSection = {
  padding: "32px 32px 0",
};

const heading = {
  color: "#111827",
  fontSize: "20px",
  fontWeight: "700" as const,
  margin: "0 0 16px",
  lineHeight: "1.4",
};

const paragraph = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const highlight = {
  color: "#111827",
  fontWeight: "600" as const,
};

const buttonSection = {
  textAlign: "center" as const,
  padding: "8px 32px 0",
};

export default StatusPageVerificationEmail;
