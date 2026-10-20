import { eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { statusPageSubscribers } from "@/db/schema";
import {
  generateWebhookVerificationToken,
  hashWebhookVerificationToken,
} from "@/lib/webhook-utils";
import { sendWebhookVerificationChallenge } from "@/lib/webhook-delivery.service";

const WEBHOOK_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Send a fresh ownership challenge. The row stays unverified until the
 * endpoint echoes the token, and unverified rows are filtered out of every
 * notification recipient query.
 */
export async function sendWebhookChallenge(params: {
  subscriberId: string;
  endpoint: string;
  statusPageId: string;
}): Promise<{ verified: boolean; error?: string }> {
  const token = generateWebhookVerificationToken();
  const now = new Date();
  await db
    .update(statusPageSubscribers)
    .set({
      webhookVerificationTokenHash: hashWebhookVerificationToken(token),
      webhookVerificationExpiresAt: new Date(
        now.getTime() + WEBHOOK_VERIFICATION_TTL_MS,
      ),
      verifiedAt: null,
      updatedAt: now,
    })
    .where(eq(statusPageSubscribers.id, params.subscriberId));

  const result = await sendWebhookVerificationChallenge(params.endpoint, {
    type: "supercheck.webhook.verification",
    token,
    statusPageId: params.statusPageId,
    createdAt: now.toISOString(),
  });
  if (!result.success) return { verified: false, error: result.error };

  await db
    .update(statusPageSubscribers)
    .set({
      verifiedAt: new Date(),
      webhookVerificationTokenHash: null,
      webhookVerificationExpiresAt: null,
      webhookFailures: 0,
      updatedAt: new Date(),
    })
    .where(eq(statusPageSubscribers.id, params.subscriberId));
  return { verified: true };
}
