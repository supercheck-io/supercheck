"use server";

import { db } from "@/utils/db";
import {
  incidents,
  statusPages,
  statusPageSubscribers,
  incidentComponents,
} from "@/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import {
  deliverSlackMessage,
  shouldQuarantine,
  type SlackIncidentEvent,
} from "@/lib/slack-delivery.service";

/**
 * Send Slack notifications to all verified Slack subscribers
 * This is called after an incident is created or updated
 */
export async function sendSlackNotifications(
  incidentId: string,
  statusPageId: string
) {
  try {
    console.log(
      `[Slack Notifications] Sending notifications for incident ${incidentId} on status page ${statusPageId}`
    );

    // Fetch incident details
    const incident = await db.query.incidents.findFirst({
      where: eq(incidents.id, incidentId),
    });

    if (!incident) {
      console.warn(
        `[Slack Notifications] Incident not found: ${incidentId}`
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
        `[Slack Notifications] Notifications disabled for incident ${incidentId}`
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
        `[Slack Notifications] Status page not found: ${statusPageId}`
      );
      return {
        success: false,
        message: "Status page not found",
        sentCount: 0,
      };
    }

    // Check if Slack subscriptions are enabled
    if (!statusPage.allowSlackSubscribers) {
      console.log(
        `[Slack Notifications] Slack subscriptions disabled for status page ${statusPageId}`
      );
      return {
        success: true,
        message: "Slack subscriptions not enabled for this status page",
        sentCount: 0,
      };
    }

    // Get affected components
    const affectedComponentsRecords = await db.query.incidentComponents.findMany({
      where: eq(incidentComponents.incidentId, incidentId),
      with: {
        component: {
          columns: {
            name: true,
          },
        },
      },
    });

    const affectedComponents = affectedComponentsRecords.map(
      (ic) => ic.component?.name || "Unknown Component"
    );

    // Get all verified Slack subscribers for this status page
    const subscribers = await db.query.statusPageSubscribers.findMany({
      where: and(
        eq(statusPageSubscribers.statusPageId, statusPageId),
        eq(statusPageSubscribers.mode, "slack"),
        isNotNull(statusPageSubscribers.verifiedAt) // Ensure verified
      ),
    });

    // Filter verified subscribers and those not quarantined
    const activeSubscribers = subscribers.filter(
      (s) => s.verifiedAt !== null && s.quarantinedAt === null
    );

    if (activeSubscribers.length === 0) {
      console.log(
        `[Slack Notifications] No active Slack subscribers for status page ${statusPageId}`
      );
      return {
        success: true,
        message: "No active Slack subscribers to notify",
        sentCount: 0,
      };
    }

    console.log(
      `[Slack Notifications] Found ${activeSubscribers.length} active subscribers`
    );

    // Construct notification URLs
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";
    const statusPageUrl = `${baseUrl}/status/${statusPageId}`;

    // Prepare Slack event payload
    const slackEvent: SlackIncidentEvent = {
      type:
        incident.status === "resolved"
          ? "incident.resolved"
          : incident.status === "investigating"
          ? "incident.created"
          : "incident.updated",
      timestamp: new Date().toISOString(),
      statusPageId,
      statusPageName: statusPage.name,
      statusPageUrl,
      incident: {
        id: incident.id,
        name: incident.name,
        status: incident.status,
        impact: incident.impact,
        body: incident.body || "No additional details provided.",
      },
      affectedComponents,
    };

    // Send Slack messages to all active subscribers
    let successCount = 0;
    let failureCount = 0;

    const deliveryPromises = activeSubscribers.map(async (subscriber) => {
      try {
        if (!subscriber.endpoint) {
          console.warn(
            `[Slack Notifications] Subscriber ${subscriber.id} missing webhook URL`
          );
          failureCount++;
          return;
        }

        console.log(
          `[Slack Notifications] Delivering Slack message to ${subscriber.endpoint}`
        );

        const result = await deliverSlackMessage(
          subscriber.endpoint,
          slackEvent
        );

        if (result.success) {
          console.log(
            `[Slack Notifications] Slack message delivered successfully to ${subscriber.endpoint}`
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
            `[Slack Notifications] Failed to deliver Slack message to ${subscriber.endpoint}: ${result.error}`
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
              `[Slack Notifications] Quarantining subscriber ${subscriber.id} after ${newFailureCount} failures`
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
          `[Slack Notifications] Error delivering Slack message to subscriber:`,
          error
        );
        failureCount++;
      }
    });

    // Wait for all Slack messages to be delivered
    await Promise.allSettled(deliveryPromises);

    const message =
      failureCount === 0
        ? `Successfully sent ${successCount} Slack notifications`
        : `Sent ${successCount} Slack messages successfully, ${failureCount} failed`;

    console.log(`[Slack Notifications] ${message}`);

    return {
      success: failureCount === 0,
      message,
      sentCount: successCount,
      failedCount: failureCount,
    };
  } catch (error) {
    console.error("[Slack Notifications] Fatal error:", error);
    return {
      success: false,
      message: `Failed to send Slack notifications: ${
        error instanceof Error ? error.message : String(error)
      }`,
      sentCount: 0,
      error,
    };
  }
}
