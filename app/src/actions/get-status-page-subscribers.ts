"use server";

import { db } from "@/utils/db";
import { statusPageSubscribers, statusPages } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { EmailService } from "@/lib/email-service";
import { renderStatusPageVerificationEmail } from "@/lib/email-renderer";
import { z } from "zod";
import { generateWebhookSecret } from "@/lib/webhook-utils";
import { sendWebhookChallenge } from "@/lib/incident-notifications/webhook-verification";

// UUID validation schema
const uuidSchema = z.string().uuid("Invalid ID format");

export async function rotateSubscriberWebhookSecret(subscriberId: string) {
  try {
    if (!uuidSchema.safeParse(subscriberId).success) {
      return { success: false, message: "Invalid subscriber ID" };
    }
    const { organizationId, project } = await requireProjectContext();
    await requirePermissions(
      { status_page: ["update"] },
      { organizationId, projectId: project.id },
    );
    const subscriber = await db.query.statusPageSubscribers.findFirst({
      where: and(
        eq(statusPageSubscribers.id, subscriberId),
        eq(statusPageSubscribers.mode, "webhook"),
        isNull(statusPageSubscribers.purgeAt),
      ),
    });
    if (!subscriber || !(await verifyStatusPageOwnership(subscriber.statusPageId, organizationId, project.id))) {
      return { success: false, message: "Subscriber not found or access denied" };
    }
    const webhookSecret = generateWebhookSecret();
    const updated = await db.update(statusPageSubscribers).set({ webhookSecret, updatedAt: new Date() })
      .where(and(eq(statusPageSubscribers.id, subscriberId), isNull(statusPageSubscribers.purgeAt)))
      .returning({ id: statusPageSubscribers.id });
    if (!updated.length) return { success: false, message: "Subscriber is no longer active" };
    return { success: true, webhookSecret, message: "Signing secret rotated" };
  } catch (error) {
    console.error("Error rotating subscriber signing secret:", error);
    return { success: false, message: "Failed to rotate signing secret" };
  }
}

/**
 * Send a fresh ownership challenge to a pending webhook subscriber.
 *
 * SECURITY: Requires authentication, update permission, and status page
 * ownership. The endpoint comes from the stored row, never from the caller.
 */
export async function resendWebhookVerification(subscriberId: string) {
  try {
    if (!uuidSchema.safeParse(subscriberId).success)
      return { success: false, message: "Invalid subscriber ID" };

    const { organizationId, project } = await requireProjectContext();
    await requirePermissions(
      { status_page: ["update"] },
      { organizationId, projectId: project.id },
    );

    const subscriber = await db.query.statusPageSubscribers.findFirst({
      where: and(
        eq(statusPageSubscribers.id, subscriberId),
        eq(statusPageSubscribers.mode, "webhook"),
        isNull(statusPageSubscribers.purgeAt),
      ),
    });
    if (!subscriber || !subscriber.endpoint)
      return { success: false, message: "Subscriber not found" };

    const statusPage = await verifyStatusPageOwnership(
      subscriber.statusPageId,
      organizationId,
      project.id,
    );
    if (!statusPage)
      return { success: false, message: "Access denied" };
    if (subscriber.verifiedAt)
      return { success: false, message: "Subscriber is already verified" };

    const challenge = await sendWebhookChallenge({
      subscriberId: subscriber.id,
      endpoint: subscriber.endpoint,
      statusPageId: subscriber.statusPageId,
    });
    return challenge.verified
      ? { success: true, message: "Webhook endpoint verified" }
      : {
          success: false,
          message: `Verification failed: ${challenge.error}`,
        };
  } catch (error) {
    console.error("Error resending webhook verification:", error);
    return { success: false, message: "Failed to resend verification" };
  }
}

/**
 * Helper function to verify status page ownership
 */
async function verifyStatusPageOwnership(
  statusPageId: string,
  organizationId: string,
  projectId: string
): Promise<{
  id: string;
  name: string;
  headline: string | null;
  subdomain: string;
  language: string;
} | null> {
  const statusPage = await db.query.statusPages.findFirst({
    where: and(
      eq(statusPages.id, statusPageId),
      eq(statusPages.organizationId, organizationId),
      eq(statusPages.projectId, projectId)
    ),
    columns: {
      id: true,
      name: true,
      headline: true,
      subdomain: true,
      language: true,
    },
  });
  return statusPage ?? null;
}

/**
 * Slack incoming-webhook URLs are bearer credentials owned by the subscriber,
 * so the dashboard only ever sees a masked form (host + last 4 characters).
 */
function maskSlackEndpoint(endpoint: string | null): string | null {
  if (!endpoint) return endpoint;
  try {
    return `${new URL(endpoint).host}/…${endpoint.slice(-4)}`;
  } catch {
    return "…" + endpoint.slice(-4);
  }
}

/**
 * Get subscribers for a status page (authenticated, for internal management)
 *
 * SECURITY:
 * - Requires authentication via requireProjectContext
 * - Requires read permission on status_page resource
 * - Verifies ownership (status page belongs to user's org AND project)
 */
export async function getStatusPageSubscribers(statusPageId: string) {
  try {
    // Validate UUID
    if (!uuidSchema.safeParse(statusPageId).success) {
      return {
        success: false,
        message: "Invalid status page ID",
        subscribers: [],
        stats: { total: 0, verified: 0, pending: 0, quarantined: 0 },
      };
    }

    const { organizationId, project } = await requireProjectContext();

    await requirePermissions(
      { status_page: ["view"] },
      { organizationId, projectId: project.id }
    );

    // SECURITY: Verify ownership
    const statusPage = await verifyStatusPageOwnership(statusPageId, organizationId, project.id);
    if (!statusPage) {
      return {
        success: false,
        message: "Status page not found or access denied",
        subscribers: [],
        stats: { total: 0, verified: 0, pending: 0, quarantined: 0 },
      };
    }

    const subscribers = await db.query.statusPageSubscribers.findMany({
      where: and(
        eq(statusPageSubscribers.statusPageId, statusPageId),
        isNull(statusPageSubscribers.purgeAt) // Only show active subscribers
      ),
      // SECURITY: explicit allow-list; never serialize webhookSecret or
      // verification/unsubscribe tokens to the client.
      columns: {
        id: true,
        email: true,
        endpoint: true,
        mode: true,
        verifiedAt: true,
        quarantinedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: (subscribers, { desc }) => [desc(subscribers.createdAt)],
    });

    // Calculate stats
    // Quarantined endpoints receive nothing, so they are not "verified" for delivery.
    const quarantinedCount = subscribers.filter((s) => s.quarantinedAt).length;
    const verifiedCount = subscribers.filter(
      (s) => s.verifiedAt && !s.quarantinedAt,
    ).length;
    const pendingCount = subscribers.filter((s) => !s.verifiedAt).length;

    return {
      success: true,
      subscribers: subscribers.map((s) =>
        s.mode === "slack" ? { ...s, endpoint: maskSlackEndpoint(s.endpoint) } : s
      ),
      stats: {
        total: subscribers.length,
        verified: verifiedCount,
        pending: pendingCount,
        quarantined: quarantinedCount,
      },
    };
  } catch (error) {
    console.error("Error fetching subscribers:", error);
    return {
      success: false,
      message: "Failed to fetch subscribers",
      subscribers: [],
      stats: { total: 0, verified: 0, pending: 0, quarantined: 0 },
    };
  }
}

/**
 * Delete a subscriber (authenticated, for internal management)
 *
 * SECURITY:
 * - Requires authentication and ownership verification
 */
export async function deleteSubscriber(subscriberId: string) {
  try {
    // Validate UUID
    if (!uuidSchema.safeParse(subscriberId).success) {
      return { success: false, message: "Invalid subscriber ID" };
    }

    const { organizationId, project } = await requireProjectContext();

    await requirePermissions(
      { status_page: ["update"] },
      { organizationId, projectId: project.id }
    );

    // Get subscriber to verify ownership
    const subscriber = await db.query.statusPageSubscribers.findFirst({
      where: eq(statusPageSubscribers.id, subscriberId),
    });

    if (!subscriber) {
      return { success: false, message: "Subscriber not found" };
    }

    // SECURITY: Verify status page ownership
    const statusPage = await verifyStatusPageOwnership(
      subscriber.statusPageId,
      organizationId,
      project.id
    );
    if (!statusPage) {
      return { success: false, message: "Access denied" };
    }

    // Soft delete by setting purge date
    const purgeDate = new Date();
    purgeDate.setDate(purgeDate.getDate() + 30);

    await db
      .update(statusPageSubscribers)
      .set({
        purgeAt: purgeDate,
        updatedAt: new Date(),
      })
      .where(eq(statusPageSubscribers.id, subscriberId));

    return {
      success: true,
      message: "Subscriber removed successfully",
    };
  } catch (error) {
    console.error("Error deleting subscriber:", error);
    return {
      success: false,
      message: "Failed to remove subscriber",
    };
  }
}

/**
 * Resend verification email (authenticated, for internal management)
 *
 * SECURITY:
 * - Requires authentication and ownership verification
 *
 * FIX: Uses correct verification URL (/status/verify/) instead of wrong path
 * FIX: Updates updatedAt when regenerating token so expiry logic works correctly
 */
export async function resendVerificationEmail(subscriberId: string) {
  try {
    // Validate UUID
    if (!uuidSchema.safeParse(subscriberId).success) {
      return { success: false, message: "Invalid subscriber ID" };
    }

    const { organizationId, project } = await requireProjectContext();

    await requirePermissions(
      { status_page: ["update"] },
      { organizationId, projectId: project.id }
    );

    const subscriber = await db.query.statusPageSubscribers.findFirst({
      where: eq(statusPageSubscribers.id, subscriberId),
    });

    // Webhook/Slack rows have no mailbox and unsubscribed addresses opted out.
    if (!subscriber || subscriber.mode !== "email" || subscriber.purgeAt) {
      return { success: false, message: "Subscriber not found" };
    }

    // SECURITY: Verify status page ownership
    const statusPage = await verifyStatusPageOwnership(
      subscriber.statusPageId,
      organizationId,
      project.id
    );
    if (!statusPage) {
      return { success: false, message: "Access denied" };
    }

    if (subscriber.verifiedAt) {
      return { success: false, message: "Subscriber is already verified" };
    }

    // Check rate limiting (5 minutes based on updatedAt)
    const updatedAt = subscriber.updatedAt
      ? new Date(subscriber.updatedAt)
      : new Date(subscriber.createdAt || Date.now());
    const now = new Date();
    const minutesSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60);

    if (minutesSinceUpdate < 5) {
      return {
        success: false,
        message: `Please wait ${Math.ceil(5 - minutesSinceUpdate)} minutes before resending`,
      };
    }

    // Generate new verification token
    const newVerificationToken = Array.from(
      crypto.getRandomValues(new Uint8Array(32)),
      (byte) => byte.toString(16).padStart(2, "0")
    ).join("");

    // FIX: Update both token and updatedAt so expiry check uses new timestamp
    await db
      .update(statusPageSubscribers)
      .set({
        verificationToken: newVerificationToken,
        updatedAt: new Date(), // This is now used for token expiry
      })
      .where(eq(statusPageSubscribers.id, subscriberId));

    // Send verification email
    try {
      const emailService = EmailService.getInstance();
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      // FIX: Use correct verification URL path
      const verificationUrl = `${baseUrl}/status/verify/${newVerificationToken}`;

      // Render email using react-email template
      const emailContent = await renderStatusPageVerificationEmail({
        verificationUrl,
        statusPageName: statusPage.headline || statusPage.name,
        language: statusPage.language,
      });

      const result = await emailService.sendEmail({
        to: subscriber.email || "",
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      });

      if (!result.success) {
        console.error("Failed to send verification email:", result.error);
      }
    } catch (emailError) {
      console.error("Error sending verification email:", emailError);
    }

    return {
      success: true,
      message: "Verification email sent successfully",
    };
  } catch (error) {
    console.error("Error resending verification email:", error);
    return {
      success: false,
      message: "Failed to resend verification email",
    };
  }
}
