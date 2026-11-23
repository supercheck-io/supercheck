import { eq } from "drizzle-orm";

import { statusPageSubscribers, statusPages } from "@/db/schema";
import { emailAppUrl } from "@/emails/base-layout";
import { getPublicStatusPageUrl } from "@/lib/domain-utils";
import { renderStatusPageWelcomeEmail } from "@/lib/email-renderer";
import { EmailService } from "@/lib/email-service";
import { getEffectiveStatusPageDomain } from "@/lib/status-page-domain";
import { signUnsubscribeToken } from "@/lib/subscriber-tokens";
import { db } from "@/utils/db";

/**
 * Confirms a newly verified email subscription. Best effort: never throws, and sends nothing when the
 * subscriber or page no longer qualifies, or when no signed unsubscribe link can be made (as for incident emails).
 */
export async function sendSubscriberWelcome(subscriberId: string): Promise<boolean> {
  try {
    const subscriber = await db.query.statusPageSubscribers.findFirst({
      where: eq(statusPageSubscribers.id, subscriberId),
    });
    if (!subscriber?.email || subscriber.mode !== "email" || !subscriber.verifiedAt || subscriber.purgeAt || subscriber.quarantinedAt) {
      return false;
    }
    const page = await db.query.statusPages.findFirst({ where: eq(statusPages.id, subscriber.statusPageId) });
    if (!page || page.status !== "published" || !page.allowEmailSubscribers) return false;
    if (!process.env.SECRET_ENCRYPTION_KEY) {
      console.error("[Subscriber welcome] SECRET_ENCRYPTION_KEY is not set; no unsubscribe link can be signed, so no welcome email was sent");
      return false;
    }

    const appUrl = emailAppUrl();
    const token = signUnsubscribeToken(subscriber.id);
    const content = await renderStatusPageWelcomeEmail({
      statusPageName: page.name,
      statusPageUrl: getPublicStatusPageUrl({
        subdomain: page.subdomain,
        customDomain: page.customDomain,
        customDomainVerified: page.customDomainVerified,
        appUrl,
        statusPageDomain: getEffectiveStatusPageDomain(),
      }),
      unsubscribeUrl: `${appUrl}/status/unsubscribe/${token}`,
      language: page.language ?? "en",
    });
    const result = await EmailService.getInstance().sendEmail({
      to: subscriber.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
      headers: {
        "List-Unsubscribe": `<${appUrl}/api/status-pages/unsubscribe/${token}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (!result.success) console.error("[Subscriber welcome] Failed to send:", result.error);
    return result.success;
  } catch (error) {
    console.error("[Subscriber welcome] Error:", error instanceof Error ? error.message : String(error));
    return false;
  }
}
