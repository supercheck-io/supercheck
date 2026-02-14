"use server";

import { db } from "@/utils/db";
import { statusPageSubscribers, statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  deliverWebhook,
  type WebhookEvent,
} from "@/lib/webhook-delivery.service";
import { generateWebhookTestPayload } from "@/lib/webhook-utils";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";

const testWebhookSchema = z.object({
  subscriberId: z.string().uuid(),
  statusPageId: z.string().uuid(),
});

/**
 * Test webhook delivery by sending a test payload
 * Allows users to verify their webhook is working correctly
 *
 * SECURITY: Requires authentication, permission check, and ownership verification
 */
export async function testWebhook(data: z.infer<typeof testWebhookSchema>) {
  try {
    // Validate input
    const validatedData = testWebhookSchema.parse(data);

    // SECURITY: Authenticate user and verify project context
    const { userId, project, organizationId } = await requireProjectContext();

    // SECURITY: Check status page management permission
    try {
      await requirePermissions(
        { status_page: ["update"] },
        { organizationId, projectId: project.id }
      );
    } catch {
      console.warn(
        `[SECURITY] User ${userId} attempted to test webhook without permission`
      );
      return {
        success: false,
        message: "Insufficient permissions to test webhooks",
      };
    }

    // SECURITY: Verify status page belongs to this organization and project
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, validatedData.statusPageId),
        eq(statusPages.organizationId, organizationId),
        eq(statusPages.projectId, project.id)
      ),
    });

    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to test webhook for status page ${validatedData.statusPageId} without ownership`
      );
      return {
        success: false,
        message: "Status page not found or access denied",
      };
    }

    // SECURITY: Fetch subscriber scoped to the verified status page
    const subscriber = await db.query.statusPageSubscribers.findFirst({
      where: and(
        eq(statusPageSubscribers.id, validatedData.subscriberId),
        eq(statusPageSubscribers.statusPageId, validatedData.statusPageId)
      ),
    });

    if (!subscriber) {
      return {
        success: false,
        message: "Webhook subscriber not found",
      };
    }

    // Ensure it's a webhook subscriber
    if (subscriber.mode !== "webhook") {
      return {
        success: false,
        message: "This subscription is not a webhook",
      };
    }

    // Ensure webhook has endpoint and secret
    if (!subscriber.endpoint || !subscriber.webhookSecret) {
      return {
        success: false,
        message: "Webhook configuration is incomplete",
      };
    }

    // Generate test payload
    const testPayload = generateWebhookTestPayload(
      validatedData.statusPageId
    ) as WebhookEvent;

    // Attempt delivery
    console.log(
      `[Webhook Test] Testing webhook delivery to ${subscriber.endpoint}`
    );

    const result = await deliverWebhook(
      subscriber.endpoint,
      testPayload,
      subscriber.webhookSecret
    );

    if (result.success) {
      console.log(
        `[Webhook Test] Test successful for ${subscriber.endpoint}, status: ${result.statusCode}`
      );

      // Update last attempt timestamp on success
      await db
        .update(statusPageSubscribers)
        .set({
          webhookLastAttemptAt: new Date(),
          webhookFailures: 0,
          updatedAt: new Date(),
        })
        .where(eq(statusPageSubscribers.id, validatedData.subscriberId));

      // Log audit event
      await logAuditEvent({
        userId,
        action: "webhook_test_sent",
        resource: "status_page_subscriber",
        resourceId: validatedData.subscriberId,
        metadata: {
          organizationId,
          projectId: project.id,
          statusPageId: validatedData.statusPageId,
          endpoint: subscriber.endpoint,
          statusCode: result.statusCode,
        },
        success: true,
      });

      return {
        success: true,
        message: `Test successful! Your webhook received the test payload (HTTP ${result.statusCode}).`,
        statusCode: result.statusCode,
        retriesAttempted: result.retriesAttempted,
      };
    } else {
      console.error(
        `[Webhook Test] Test failed for ${subscriber.endpoint}: ${result.error}`
      );

      return {
        success: false,
        message: `Webhook test failed: ${result.error}`,
        error: result.error,
        retriesAttempted: result.retriesAttempted,
        suggestion:
          result.error?.includes("timeout") ||
          result.error?.includes("ECONNREFUSED")
            ? "Check that your webhook URL is accessible and responding within 10 seconds."
            : result.error?.includes("HTTP 4")
            ? "Check your webhook configuration. Your endpoint returned a client error (4xx)."
            : "Check that your webhook endpoint is working correctly.",
      };
    }
  } catch (error) {
    console.error("[Webhook Test] Fatal error:", error);

    if (error instanceof z.ZodError) {
      return {
        success: false,
        message: "Invalid request data",
      };
    }

    return {
      success: false,
      message: `Failed to test webhook: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      error,
    };
  }
}
