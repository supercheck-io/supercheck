import { Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout, EmailButton, SubscriberFooter } from "./base-layout";
import { getTranslations } from "../lib/status-page-translations";

interface StatusPageWelcomeEmailProps {
  statusPageName: string;
  statusPageUrl: string;
  unsubscribeUrl: string;
  language?: string;
}

/** Sent once a subscriber confirms their address: what they will get, and how to stop it. */
export const StatusPageWelcomeEmail = ({
  statusPageName = "Example Status Page",
  statusPageUrl = "https://example.supercheck.io",
  unsubscribeUrl = "https://example.supercheck.io/unsubscribe?token=abc123",
  language = "en",
}: StatusPageWelcomeEmailProps) => {
  const t = getTranslations(language);
  return (
    <BaseLayout
      preview={`${t.emailNowSubscribed} ${statusPageName}. ${t.verifiedWillReceive}`}
      title={statusPageName}
      lang={language}
      showBrand={false}
      showStandardFooter={false}
      footer={
        <SubscriberFooter
          notice={`${t.emailSubscriptionNotice} ${statusPageName}.`}
          links={[
            { href: statusPageUrl, label: t.emailViewStatusPage },
            { href: unsubscribeUrl, label: t.unsubscribe },
          ]}
          poweredBy={t.poweredBy}
        />
      }
    >
      <Section style={contentSection}>
        <Text style={heading}>{t.emailSubscriptionConfirmed}</Text>
        <Text style={paragraph}>
          {t.emailNowSubscribed} <strong style={highlight}>{statusPageName}</strong>.
        </Text>
        <Text style={paragraph}>{t.verifiedWillReceive}</Text>
      </Section>

      <Section style={buttonSection}>
        <EmailButton href={statusPageUrl}>{t.emailViewStatusPage}</EmailButton>
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
  padding: "8px 32px 32px",
};

export default StatusPageWelcomeEmail;
