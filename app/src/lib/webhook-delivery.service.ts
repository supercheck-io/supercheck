/**
 * Webhook Delivery Service
 *
 * Handles robust webhook delivery with:
 * - Exponential backoff retry logic
 * - Request timeout protection
 * - Security validation (HMAC signature)
 * - Failure tracking and quarantine
 * - Rate limiting protection
 */

import crypto from "crypto";

export type WebhookEvent = {
  type: "incident.created" | "incident.updated" | "incident.resolved";
  timestamp: string;
  statusPageId: string;
  incident: {
    id: string;
    name: string;
    status: string;
    impact: string;
    body: string;
  };
};

export type WebhookDeliveryResult = {
  success: boolean;
  statusCode?: number;
  error?: string;
  retriesAttempted: number;
};

/**
 * Webhook delivery configuration
 */
const WEBHOOK_CONFIG = {
  // Max number of retry attempts
  MAX_RETRIES: 3,
  // Initial delay in milliseconds (will exponentially increase)
  INITIAL_DELAY_MS: 1000,
  // Maximum delay between retries
  MAX_DELAY_MS: 60000,
  // Request timeout
  TIMEOUT_MS: 10000,
  // Acceptable HTTP status codes for success
  SUCCESS_STATUS_CODES: [200, 201, 202, 204],
  // Failure threshold before quarantining
  FAILURE_THRESHOLD: 10,
};

/**
 * Generate HMAC-SHA256 signature for webhook payload
 * Allows webhook recipient to verify the authenticity of the request
 */
export function generateWebhookSignature(
  payload: string,
  secret: string
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = generateWebhookSignature(payload, secret);
  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Deliver webhook to endpoint with retry logic
 *
 * @param endpoint - Webhook URL to deliver to
 * @param event - Webhook event payload
 * @param secret - Secret for HMAC signature (required for security)
 * @returns Result of delivery attempt
 */
export async function deliverWebhook(
  endpoint: string,
  event: WebhookEvent,
  secret: string
): Promise<WebhookDeliveryResult> {
  // Validate endpoint URL
  try {
    new URL(endpoint);
  } catch {
    return {
      success: false,
      error: "Invalid webhook endpoint URL",
      retriesAttempted: 0,
    };
  }

  // Validate secret
  if (!secret || secret.length < 8) {
    return {
      success: false,
      error: "Webhook secret must be at least 8 characters",
      retriesAttempted: 0,
    };
  }

  const payload = JSON.stringify(event);
  const signature = generateWebhookSignature(payload, secret);

  let lastError: string | undefined;
  let lastStatusCode: number | undefined;

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt <= WEBHOOK_CONFIG.MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Include signature for verification
          "X-Webhook-Signature": `sha256=${signature}`,
          // Include event type for filtering
          "X-Webhook-Event": event.type,
          // Include timestamp for replay protection
          "X-Webhook-Timestamp": event.timestamp,
          // User-Agent for identification
          "User-Agent": "Supercheck/1.0 (Webhook Delivery)",
        },
        body: payload,
        signal: AbortSignal.timeout(WEBHOOK_CONFIG.TIMEOUT_MS),
      });

      lastStatusCode = response.status;

      // Check if response was successful
      if (WEBHOOK_CONFIG.SUCCESS_STATUS_CODES.includes(response.status)) {
        return {
          success: true,
          statusCode: response.status,
          retriesAttempted: attempt,
        };
      }

      // Non-success status code
      lastError = `HTTP ${response.status}`;

      // Don't retry on 4xx errors (client errors) unless it's 429 (rate limit)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return {
          success: false,
          statusCode: response.status,
          error: lastError,
          retriesAttempted: attempt,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      lastError = errorMessage;

      // Check if this is a timeout or network error that should be retried
      if (
        errorMessage.includes("timeout") ||
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("ENOTFOUND")
      ) {
        // Retryable error, continue to next attempt
      } else {
        // Non-retryable error
        return {
          success: false,
          error: lastError,
          retriesAttempted: attempt,
        };
      }
    }

    // If not the last attempt, wait before retrying
    if (attempt < WEBHOOK_CONFIG.MAX_RETRIES) {
      const delayMs = Math.min(
        WEBHOOK_CONFIG.INITIAL_DELAY_MS * Math.pow(2, attempt),
        WEBHOOK_CONFIG.MAX_DELAY_MS
      );

      // Add jitter to prevent thundering herd
      const jitter = Math.random() * 0.1 * delayMs;
      await new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
    }
  }

  // All retries exhausted
  return {
    success: false,
    statusCode: lastStatusCode,
    error: `Failed after ${WEBHOOK_CONFIG.MAX_RETRIES + 1} attempts. Last error: ${lastError}`,
    retriesAttempted: WEBHOOK_CONFIG.MAX_RETRIES + 1,
  };
}

/**
 * Should subscriber be quarantined based on failure count?
 */
export function shouldQuarantine(failureCount: number): boolean {
  return failureCount >= WEBHOOK_CONFIG.FAILURE_THRESHOLD;
}

/**
 * Get human-readable webhook event description
 */
export function getWebhookEventDescription(event: WebhookEvent): string {
  const descriptions = {
    "incident.created": `New incident: ${event.incident.name}`,
    "incident.updated": `Incident update: ${event.incident.name}`,
    "incident.resolved": `Incident resolved: ${event.incident.name}`,
  };
  return descriptions[event.type];
}
