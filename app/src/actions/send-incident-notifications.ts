"use server";

import { db } from "@/utils/db";
import {
  incidents,
  statusPages,
  statusPageSubscribers,
  incidentComponents,
} from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { EmailService } from "@/lib/email-service";
import { renderIncidentNotificationEmail } from "@/lib/email-renderer";
import { format } from "date-fns";

/**
 * Send incident notification emails to all verified subscribers
 * This is called after an incident is created or updated
 */
export async function sendIncidentNotifications(
  incidentId: string,
  statusPageId: string
) {
  try {
    // Fetch incident details
    const incident = await db.query.incidents.findFirst({
      where: eq(incidents.id, incidentId),
    });

    if (!incident) {
      console.warn(
        `[Incident Notifications] Incident not found: ${incidentId}`
      );
      return {
        success: false,
        message: "Incident not found",
        sentCount: 0,
      };
    }

    // Check if notifications should be sent
    if (!incident.deliverNotifications) {
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
        `[Incident Notifications] Status page not found: ${statusPageId}`
      );
      return {
        success: false,
        message: "Status page not found",
        sentCount: 0,
      };
    }

    // Check if email subscriptions are enabled
    if (!statusPage.allowEmailSubscribers) {
      return {
        success: true,
        message: "Email subscriptions not enabled for this status page",
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

    // Get all verified, active subscribers for this status page
    // SECURITY: Filter out unsubscribed users (purgeAt != null)
    const subscribers = await db.query.statusPageSubscribers.findMany({
      where: and(
        eq(statusPageSubscribers.statusPageId, statusPageId),
        eq(statusPageSubscribers.mode, "email"),
        isNull(statusPageSubscribers.purgeAt) // Don't send to unsubscribed users
      ),
    });

    // Filter verified subscribers (have verifiedAt timestamp)
    const verifiedSubscribers = subscribers.filter((s) => s.verifiedAt !== null);

    if (verifiedSubscribers.length === 0) {
      return {
        success: true,
        message: "No verified subscribers to notify",
        sentCount: 0,
      };
    }

    // Construct notification URLs
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";
    const statusPageUrl = `${baseUrl}/status/${statusPageId}`;

    // Build email parameters template (per-subscriber unsubscribe URL will be added when sending)
    const formatIncidentTimestamp = (date: Date | null) => {
      return date ? format(date, "PPpp") : "Just now";
    };

    const emailParamsTemplate = {
      statusPageName: statusPage.name,
      statusPageUrl,
      incidentName: incident.name,
      incidentStatus: incident.status,
      incidentImpact: incident.impact,
      incidentDescription: incident.body || "No additional details provided.",
      affectedComponents,
      updateTimestamp: formatIncidentTimestamp(incident.createdAt),
    };

    // Send emails to all subscribers
    const emailService = EmailService.getInstance();
    let successCount = 0;
    let failureCount = 0;

    const sendPromises = verifiedSubscribers.map(async (subscriber) => {
      try {
        if (!subscriber.email) {
          console.warn(
            `[Incident Notifications] Subscriber ${subscriber.id} has no email address`
          );
          return { success: false };
        }

        // Use per-subscriber unsubscribe token
        const unsubscribeUrl = subscriber.unsubscribeToken
          ? `${baseUrl}/status/unsubscribe/${subscriber.unsubscribeToken}`
          : "";

        const emailParams = {
          ...emailParamsTemplate,
          unsubscribeUrl,
        };

        // Render email using react-email template
        const emailContent = await renderIncidentNotificationEmail(emailParams);

        const result = await emailService.sendEmail({
          to: subscriber.email,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
        });

        if (result.success) {
          return { success: true };
        } else {
          console.error(
            `[Incident Notifications] Failed to send email to ${subscriber.email}: ${result.error}`
          );
          return { success: false };
        }
      } catch (error) {
        console.error(
          `[Incident Notifications] Error sending email to subscriber:`,
          error
        );
        return { success: false };
      }
    });

    // Wait for all emails to be sent and count results
    const results = await Promise.allSettled(sendPromises);
    results.forEach((result) => {
      if (result.status === "fulfilled" && result.value?.success) {
        successCount++;
      } else {
        failureCount++;
      }
    });

    const message =
      failureCount === 0
        ? `Successfully sent ${successCount} notification emails`
        : `Sent ${successCount} emails successfully, ${failureCount} failed`;

    return {
      success: failureCount === 0,
      message,
      sentCount: successCount,
      failedCount: failureCount,
    };
  } catch (error) {
    console.error("[Incident Notifications] Fatal error:", error);
    return {
      success: false,
      message: `Failed to send incident notifications: ${
        error instanceof Error ? error.message : String(error)
      }`,
      sentCount: 0,
      error,
    };
  }
}
