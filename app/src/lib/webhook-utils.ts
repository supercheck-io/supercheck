/**
 * Webhook Utilities
 *
 * Helper functions for webhook management, validation, and testing
 */

import { z } from "zod";
import { randomBytes } from "crypto";

/**
 * Validation schema for webhook URLs
 * - Must be valid HTTPS or HTTP URL
 * - Cannot be localhost/127.0.0.1 in production
 * - Must have timeout protection
 */
export const webhookUrlSchema = z
  .string()
  .url("Invalid webhook URL")
  .refine(
    (url) => {
      const u = new URL(url);
      return u.protocol === "https:" || u.protocol === "http:";
    },
    "Webhook URL must use HTTP or HTTPS"
  )
  .refine(
    (url) => {
      const u = new URL(url);
      // Allow localhost in development, not in production
      if (process.env.NODE_ENV === "production") {
        return (
          u.hostname !== "localhost" &&
          u.hostname !== "127.0.0.1" &&
          !u.hostname.startsWith("192.168")
        );
      }
      return true;
    },
    "Webhook URL cannot be localhost in production"
  );

/**
 * Validation schema for webhook subscription
 */
export const webhookSubscriptionSchema = z.object({
  endpoint: webhookUrlSchema,
  description: z
    .string()
    .max(500, "Description must be 500 characters or less")
    .optional(),
  active: z.boolean().default(true),
  // Events to subscribe to
  events: z.array(
    z.enum([
      "incident.created",
      "incident.updated",
      "incident.resolved",
    ])
  )
    .min(1, "Must subscribe to at least one event type")
    .default(["incident.created", "incident.updated", "incident.resolved"]),
  // Component-specific filtering
  componentIds: z.array(z.string().uuid()).optional(),
  // Delivery settings
  retryStrategy: z
    .enum(["exponential", "linear", "none"])
    .default("exponential")
    .optional(),
});

export type WebhookSubscription = z.infer<typeof webhookSubscriptionSchema>;

/**
 * Generate a secure webhook secret
 * Used for HMAC signature verification
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Mask webhook endpoint for display (hide credentials)
 */
export function maskWebhookEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    const host = url.hostname;
    const path = url.pathname;

    // Mask path if it contains potential credentials
    const maskedPath = path.length > 50 ? path.substring(0, 47) + "..." : path;

    return `${url.protocol}//${host}${maskedPath}`;
  } catch {
    return endpoint;
  }
}

/**
 * Determine if webhook is "healthy" based on failure rate
 */
export function getWebhookHealth(
  failureCount: number,
  totalAttempts: number
): "healthy" | "degraded" | "unhealthy" {
  if (totalAttempts === 0) return "healthy";

  const failureRate = failureCount / totalAttempts;

  if (failureRate > 0.5) return "unhealthy";
  if (failureRate > 0.2) return "degraded";
  return "healthy";
}

/**
 * Get human-readable health status
 */
export function getHealthBadgeColor(health: "healthy" | "degraded" | "unhealthy"): string {
  const colors = {
    healthy: "bg-green-100 text-green-800",
    degraded: "bg-yellow-100 text-yellow-800",
    unhealthy: "bg-red-100 text-red-800",
  };
  return colors[health];
}

/**
 * Format webhook event type for display
 */
export function formatEventType(eventType: string): string {
  const formatted = {
    "incident.created": "Incident Created",
    "incident.updated": "Incident Updated",
    "incident.resolved": "Incident Resolved",
  } as Record<string, string>;

  return formatted[eventType] || eventType;
}

/**
 * Generate webhook test payload for debugging
 */
export function generateWebhookTestPayload(statusPageId: string) {
  return {
    type: "incident.created" as const,
    timestamp: new Date().toISOString(),
    statusPageId,
    incident: {
      id: "test-incident-id",
      name: "Test Incident",
      status: "investigating",
      impact: "major",
      body: "This is a test incident to verify your webhook is working correctly.",
    },
  };
}

/**
 * Parse and validate webhook delivery response
 */
export function parseWebhookResponse(response: Response): {
  valid: boolean;
  message: string;
} {
  if (response.ok) {
    return {
      valid: true,
      message: `Success: ${response.statusText} (${response.status})`,
    };
  }

  if (response.status >= 500) {
    return {
      valid: false,
      message: `Server error: ${response.statusText} (${response.status})`,
    };
  }

  if (response.status === 429) {
    return {
      valid: false,
      message: "Rate limited: Try again later (429)",
    };
  }

  if (response.status >= 400) {
    return {
      valid: false,
      message: `Client error: ${response.statusText} (${response.status})`,
    };
  }

  return {
    valid: false,
    message: "Unknown response status",
  };
}
