import { EmailService } from "@/lib/email-service";
import { renderTrialNotificationEmail } from "@/lib/email-renderer";
import type { DeliverTrialReminder } from "./trial-lifecycle";

/** Public app origin; trial emails go to inboxes, so a relative link is never acceptable. */
const trialAppUrl = (env: NodeJS.ProcessEnv) =>
  (env.NEXT_PUBLIC_APP_URL || env.BETTER_AUTH_URL || "https://app.supercheck.io").replace(/\/+$/, "");

/** Where the reminder sends people to choose a plan. */
export function trialSubscribeUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return `${trialAppUrl(env)}/subscribe`;
}

/**
 * Renders and sends one trial reminder to the organization owners. Resolves
 * true if it reached at least one owner, so a failed send is retried later.
 */
export const deliverTrialReminder: DeliverTrialReminder = async (delivery) => {
  const email = await renderTrialNotificationEmail({
    organizationName: delivery.organizationName,
    kind: delivery.kind,
    daysRemaining: delivery.daysRemaining,
    subscribeUrl: trialSubscribeUrl(),
    manageBillingUrl: `${trialAppUrl(process.env)}/org-admin?tab=subscription`,
  });
  const result = await EmailService.getInstance().sendEmailToMultiple({
    recipients: delivery.recipients,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  return result.sentCount > 0;
};
