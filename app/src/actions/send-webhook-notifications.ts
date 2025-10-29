"use server";

import { db } from "@/utils/db";
import {
  incidents,
  statusPages,
  statusPageSubscribers,
} from "@/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import {
  deliverWebhook,
  shouldQuarantine,
  type WebhookEvent,
} from "@/lib/webhook-delivery.service";

/**
 * Send webhook notifications to all verified webhook subscribers
 * This is called after an incident is created or updated
 */
export async function sendWebhookNotifications(
  incidentId: string,
  statusPageId: string
) {
  try {
    console.log(
      `[Webhook Notifications] Sending notifications for incident ${incidentId} on status page ${statusPageId}`
    );

    // Fetch incident details
    const incident = await db.query.incidents.findFirst({
      where: eq(incidents.id, incidentId),
    });

    if (!incident) {
      console.warn(
        `[Webhook Notifications] Incident not found: ${incidentId}`
      );
      return {
        success: false,
        message: "Incident not found",
        sentCount: 0,
      };
    }

    // Check if notifications should be sent
    if (!incident.deliverNotifications) {
      console.log(
        `[Webhook Notifications] Notifications disabled for incident ${incidentId}`
      );
      return {
        success: true,
        message: "Notifications disabled for this incident",
        sentCount: 0,
      };
    }

    // Fetch status page details
    const statusPage = await db.query.statusPages.findFirst({
      where: eq(statusPages.id, statusPageId),
    });

    if (!statusPage) {
      console.warn(
        `[Webhook Notifications] Status page not found: ${statusPageId}`
      );
      return {
        success: false,
        message: "Status page not found",
        sentCount: 0,
      };
    }

    // Check if webhook subscriptions are enabled
    if (!statusPage.allowWebhookSubscribers) {
      console.log(
        `[Webhook Notifications] Webhook subscriptions disabled for status page ${statusPageId}`
      );
      return {
        success: true,
        message: "Webhook subscriptions not enabled for this status page",
        sentCount: 0,
      };
    }

    // Get all verified webhook subscribers for this status page
    const subscribers = await db.query.statusPageSubscribers.findMany({
      where: and(
        eq(statusPageSubscribers.statusPageId, statusPageId),
        eq(statusPageSubscribers.mode, "webhook"),
        isNotNull(statusPageSubscribers.verifiedAt) // Ensure verified
      ),
    });

    // Filter verified subscribers and those not quarantined
    const activeSubscribers = subscribers.filter(
      (s) => s.verifiedAt !== null && s.quarantinedAt === null
    );

    if (activeSubscribers.length === 0) {
      console.log(
        `[Webhook Notifications] No active webhook subscribers for status page ${statusPageId}`
      );
      return {
        success: true,
        message: "No active webhook subscribers to notify",
        sentCount: 0,
      };
    }

    console.log(
      `[Webhook Notifications] Found ${activeSubscribers.length} active subscribers`
    );

    // Prepare webhook event payload
    const webhookEvent: WebhookEvent = {
      type:
        incident.status === "resolved"
          ? "incident.resolved"
          : incident.status === "investigating"
          ? "incident.created"
          : "incident.updated",
      timestamp: new Date().toISOString(),
      statusPageId,
      incident: {
        id: incident.id,
        name: incident.name,
        status: incident.status,
        impact: incident.impact,
        body: incident.body || "No additional details provided.",
      },
    };

    // Send webhooks to all active subscribers
    let successCount = 0;
    let failureCount = 0;

    const deliveryPromises = activeSubscribers.map(async (subscriber) => {
      try {
        if (!subscriber.endpoint || !subscriber.webhookSecret) {
          console.warn(
            `[Webhook Notifications] Subscriber ${subscriber.id} missing endpoint or secret`
          );
          failureCount++;
          return;
        }

        console.log(
          `[Webhook Notifications] Delivering webhook to ${subscriber.endpoint}`
        );

        const result = await deliverWebhook(
          subscriber.endpoint,
          webhookEvent,
          subscriber.webhookSecret
        );

        if (result.success) {
          console.log(
            `[Webhook Notifications] Webhook delivered successfully to ${subscriber.endpoint}`
          );
          successCount++;

          // Update last attempt timestamp
          await db
            .update(statusPageSubscribers)
            .set({
              webhookLastAttemptAt: new Date(),
              webhookFailures: 0, // Reset failure count on success
              updatedAt: new Date(),
            })
            .where(eq(statusPageSubscribers.id, subscriber.id));
        } else {
          console.error(
            `[Webhook Notifications] Failed to deliver webhook to ${subscriber.endpoint}: ${result.error}`
          );
          failureCount++;

          // Track failure and quarantine if threshold exceeded
          const newFailureCount = (subscriber.webhookFailures || 0) + 1;
          const updates: Record<string, unknown> = {
            webhookLastAttemptAt: new Date(),
            webhookFailures: newFailureCount,
            webhookLastError: result.error,
            updatedAt: new Date(),
          };

          if (shouldQuarantine(newFailureCount)) {
            console.warn(
              `[Webhook Notifications] Quarantining subscriber ${subscriber.id} after ${newFailureCount} failures`
            );
            updates.quarantinedAt = new Date();
          }

          await db
            .update(statusPageSubscribers)
            .set(updates)
            .where(eq(statusPageSubscribers.id, subscriber.id));
        }
      } catch (error) {
        console.error(
          `[Webhook Notifications] Error delivering webhook to subscriber:`,
          error
        );
        failureCount++;
      }
    });

    // Wait for all webhooks to be delivered
    await Promise.allSettled(deliveryPromises);

    const message =
      failureCount === 0
        ? `Successfully sent ${successCount} webhook notifications`
        : `Sent ${successCount} webhooks successfully, ${failureCount} failed`;

    console.log(`[Webhook Notifications] ${message}`);

    return {
      success: failureCount === 0,
      message,
      sentCount: successCount,
      failedCount: failureCount,
    };
  } catch (error) {
    console.error("[Webhook Notifications] Fatal error:", error);
    return {
      success: false,
      message: `Failed to send webhook notifications: ${
        error instanceof Error ? error.message : String(error)
      }`,
      sentCount: 0,
      error,
    };
  }
}
