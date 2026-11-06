import { auditLogs } from "@/db/schema";
import { db } from "@/utils/db";
import type { UnrecoverableWebhookError } from "./polar-event-transaction";

export const WEBHOOK_UNRECOVERABLE_ACTION = "polar_webhook_unrecoverable";

/**
 * Records an acknowledged-but-unapplied event. The failed handler's transaction (claim row included)
 * has already rolled back, so this uses the pool, not the webhook transaction. Best effort: a failure
 * here is logged and never turns the acknowledgement into a retry (which could disable the endpoint).
 */
export async function recordUnrecoverableWebhook(error: UnrecoverableWebhookError): Promise<void> {
  try {
    const { organizationId, ...refs } = error.context ?? { eventType: "unknown" };
    await db.insert(auditLogs).values({
      // The id comes from the payload: store it only when it is a UUID.
      organizationId: organizationId && /^[0-9a-f-]{36}$/i.test(organizationId) ? organizationId : null,
      action: WEBHOOK_UNRECOVERABLE_ACTION,
      details: { resource: "polar_webhook", resourceId: refs.resourceId ?? refs.eventId, metadata: { ...refs, reason: error.message } },
    });
  } catch (persistError) {
    console.error("[Polar] Failed to record an acknowledged webhook failure:", persistError);
  }
}
