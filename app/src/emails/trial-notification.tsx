import { Button, Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout } from "./base-layout";

export type TrialNotificationKind = "midway" | "ending" | "ended";

interface TrialNotificationEmailProps {
  organizationName: string;
  kind: TrialNotificationKind;
  daysRemaining: number;
  subscribeUrl: string;
}

const COPY: Record<
  TrialNotificationKind,
  (days: number) => {
    title: string;
    heading: string;
    body: string;
    cta: string;
  }
> = {
  midway: (days) => ({
    title: "Your trial is halfway through",
    heading: `${days} days left in your free trial`,
    body: "Make the most of it: add your monitors, publish a status page, and try an AI SRE investigation. When you are ready to keep going, choose a plan and everything stays exactly as you set it up.",
    cta: "Choose a plan",
  }),
  ending: () => ({
    title: "Your trial ends tomorrow",
    heading: "Your free trial ends within a day",
    body: "Subscribe to keep your monitors running and your status pages online. If the trial ends first, your monitors are paused and your status pages are archived. Nothing is deleted, and subscribing restores them.",
    cta: "Keep everything running",
  }),
  ended: () => ({
    title: "Your trial has ended",
    heading: "Your free trial has ended",
    body: "Your monitors are paused and your status pages are archived. Nothing was deleted: your tests, monitors, and history are kept. Choose a plan and your monitors and status pages are restored automatically.",
    cta: "Restore my setup",
  }),
};

export function trialNotificationSubject(
  kind: TrialNotificationKind,
  organizationName: string,
  daysRemaining: number,
): string {
  const { title } = COPY[kind](daysRemaining);
  return `${title} - ${organizationName} on Supercheck`;
}

export const TrialNotificationEmail = ({
  organizationName = "Acme Corp",
  kind = "midway",
  daysRemaining = 7,
  subscribeUrl = "https://app.supercheck.io/subscribe",
}: TrialNotificationEmailProps) => {
  const copy = COPY[kind](daysRemaining);
  return (
    <BaseLayout
      preview={copy.heading}
      title="Free trial"
      headerColor={kind === "midway" ? "#1d4ed8" : "#b45309"}
    >
      <Section style={contentSection}>
        <Text style={heading}>{copy.heading}</Text>
        <Text style={paragraph}>
          <strong>{organizationName}</strong>
        </Text>
        <Text style={paragraph}>{copy.body}</Text>
        <Section style={buttonContainer}>
          <Button style={button} href={subscribeUrl}>
            {copy.cta}
          </Button>
        </Section>
      </Section>
    </BaseLayout>
  );
};

export default TrialNotificationEmail;

const contentSection = { padding: "32px 32px 0" };
const heading = {
  color: "#111827",
  fontSize: "24px",
  fontWeight: "700" as const,
  lineHeight: "1.3",
  margin: "0 0 16px",
  textAlign: "center" as const,
};
const paragraph = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 20px",
  textAlign: "center" as const,
};
const buttonContainer = { textAlign: "center" as const, margin: "8px 0 24px" };
const button = {
  backgroundColor: "#111827",
  borderRadius: "6px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "600" as const,
  padding: "12px 24px",
  textDecoration: "none",
};
