import { Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout, DetailsTable, formatEmailTime } from "./base-layout";

interface TestEmailProps {
  testMessage?: string;
  /** Send time; defaults to now. */
  sentAt?: Date;
}

export const TestEmail = ({
  testMessage,
  sentAt,
}: TestEmailProps) => {
  return (
    <BaseLayout
      preview="Your email channel works. Supercheck alerts to this address will arrive like this one."
      title="Test email"
      reason="You received this because someone sent a test from a Supercheck email notification channel."
    >
      <Section style={contentSection}>
        <Text style={paragraph}>
          Your email channel works. Supercheck alerts sent to this address will arrive like this one.
        </Text>
        {testMessage && <Text style={paragraph}>{testMessage}</Text>}
      </Section>

      <DetailsTable heading="Test details" fields={[{ title: "Sent at", value: formatEmailTime(sentAt ?? new Date()) }]} />
    </BaseLayout>
  );
};

const contentSection = {
  padding: "32px 32px 8px",
};

const paragraph = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

export default TestEmail;
