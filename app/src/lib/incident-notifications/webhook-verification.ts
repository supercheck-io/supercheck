import { and, count, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@/utils/db";
import { statusPageSubscribers, statusPages } from "@/db/schema";
import { checkSubscriberLimit } from "@/lib/middleware/plan-enforcement";
import { insertWithinPlanLimit } from "@/lib/middleware/plan-limit-lock";
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
  const tokenHash = hashWebhookVerificationToken(token);
  const [pending] = await db
    .update(statusPageSubscribers)
    .set({
      webhookVerificationTokenHash: tokenHash,
      webhookVerificationExpiresAt: new Date(
        now.getTime() + WEBHOOK_VERIFICATION_TTL_MS,
      ),
      verifiedAt: null,
      updatedAt: now,
    })
    .where(and(
      eq(statusPageSubscribers.id, params.subscriberId),
      eq(statusPageSubscribers.statusPageId, params.statusPageId),
      eq(statusPageSubscribers.endpoint, params.endpoint),
      eq(statusPageSubscribers.mode, "webhook"),
      isNull(statusPageSubscribers.purgeAt),
      isNull(statusPageSubscribers.verifiedAt),
    ))
    .returning({ id: statusPageSubscribers.id });
  if (!pending) return { verified: false, error: "Subscriber is no longer pending verification." };

  const result = await sendWebhookVerificationChallenge(params.endpoint, {
    type: "supercheck.webhook.verification",
    token,
    statusPageId: params.statusPageId,
    createdAt: now.toISOString(),
  });
  if (!result.success) return { verified: false, error: result.error };

  const page = await db.query.statusPages.findFirst({
    where: eq(statusPages.id, params.statusPageId),
    columns: { organizationId: true },
  });
  if (!page) return { verified: false, error: "Status page no longer exists." };

  const activate = (executor: Pick<typeof db, "update">) => executor
    .update(statusPageSubscribers)
    .set({
      verifiedAt: new Date(),
      webhookVerificationTokenHash: null,
      webhookVerificationExpiresAt: null,
      webhookFailures: 0,
      updatedAt: new Date(),
    })
    .where(and(
      eq(statusPageSubscribers.id, params.subscriberId),
      eq(statusPageSubscribers.webhookVerificationTokenHash, tokenHash),
      isNull(statusPageSubscribers.purgeAt),
      isNull(statusPageSubscribers.verifiedAt),
    ))
    .returning({ id: statusPageSubscribers.id });

  // Ownership checks perform network I/O outside the plan lock. Only the
  // current challenge may activate, and activation shares email/Slack limits.
  const activated = page.organizationId
    ? await insertWithinPlanLimit({
        organizationId: page.organizationId,
        resource: "subscribers",
        lockKey: params.statusPageId,
        check: checkSubscriberLimit,
        countRows: async (tx) => {
          const [row] = await tx.select({ value: count() })
            .from(statusPageSubscribers)
            .where(and(
              eq(statusPageSubscribers.statusPageId, params.statusPageId),
              ne(statusPageSubscribers.id, params.subscriberId),
              isNull(statusPageSubscribers.purgeAt),
              isNotNull(statusPageSubscribers.verifiedAt),
            ));
          return row?.value ?? 0;
        },
        insert: activate,
      })
    : { ok: true as const, row: await activate(db) };
  if (!activated.ok) return {
    verified: false,
    error: activated.busy
      ? "Too many concurrent requests. Please retry shortly."
      : activated.check.error || "Subscriber limit reached for this status page.",
  };
  if (!activated.row.length) return {
    verified: false,
    error: "Verification was superseded or the subscriber is no longer active. Please retry.",
  };
  return { verified: true };
}
