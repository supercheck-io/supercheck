/**
 * Slack Delivery Service
 *
 * Handles robust Slack webhook delivery with:
 * - Slack Block Kit message formatting
 * - Exponential backoff retry logic
 * - Request timeout protection
 * - Failure tracking and quarantine
 * - Rich formatting for incident notifications
 */

export type SlackIncidentEvent = {
  type: "incident.created" | "incident.updated" | "incident.resolved";
  timestamp: string;
  statusPageId: string;
  statusPageName: string;
  statusPageUrl: string;
  incident: {
    id: string;
    name: string;
    status: string;
    impact: string;
    body: string;
  };
  affectedComponents?: string[];
};

export type SlackDeliveryResult = {
  success: boolean;
  statusCode?: number;
  error?: string;
  retriesAttempted: number;
};

/**
 * Slack delivery configuration
 */
const SLACK_CONFIG = {
  // Max number of retry attempts
  MAX_RETRIES: 3,
  // Initial delay in milliseconds (will exponentially increase)
  INITIAL_DELAY_MS: 1000,
  // Maximum delay between retries
  MAX_DELAY_MS: 60000,
  // Request timeout
  TIMEOUT_MS: 10000,
  // Acceptable HTTP status codes for success
  SUCCESS_STATUS_CODES: [200],
  // Failure threshold before quarantining
  FAILURE_THRESHOLD: 10,
};

/**
 * Get color for Slack message based on incident status and impact level
 * When status is "resolved", always show green
 */
function getSlackColor(status: string, impact: string): string {
  // Resolved incidents always show green
  if (status.toLowerCase() === "resolved") {
    return "#22c55e"; // Green-500
  }

  // For non-resolved incidents, use impact-based colors
  switch (impact.toLowerCase()) {
    case "critical":
      return "#dc2626"; // Red
    case "major":
      return "#ea580c"; // Orange
    case "minor":
      return "#f59e0b"; // Amber
    default:
      return "#6b7280"; // Gray
  }
}

/**
 * Get emoji for incident status
 */
function getStatusEmoji(status: string): string {
  switch (status.toLowerCase()) {
    case "investigating":
      return "🔍";
    case "identified":
      return "✅";
    case "monitoring":
      return "👀";
    case "resolved":
      return "✅";
    case "scheduled":
      return "📅";
    default:
      return "ℹ️";
  }
}

/**
 * Get emoji for impact level
 */
function getImpactEmoji(impact: string): string {
  switch (impact.toLowerCase()) {
    case "critical":
      return "🔴";
    case "major":
      return "🟠";
    case "minor":
      return "🟡";
    case "none":
      return "🟢";
    default:
      return "⚪";
  }
}

/**
 * Format incident event as Slack message
 *
 * Uses the same attachment format with fields as monitor notifications
 * for consistent formatting across all Slack messages.
 */
export function formatSlackMessage(event: SlackIncidentEvent): unknown {
  const { incident, statusPageName, statusPageUrl, affectedComponents } = event;

  const color = getSlackColor(incident.status, incident.impact);
  const statusEmoji = getStatusEmoji(incident.status);
  const impactEmoji = getImpactEmoji(incident.impact);

  // Format status for display
  const formattedStatus = incident.status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  // Format impact for display
  const formattedImpact =
    incident.impact.charAt(0).toUpperCase() + incident.impact.slice(1);

  // Get event type label
  const eventTypeLabels: Record<string, string> = {
    "incident.created": "New Incident",
    "incident.updated": "Incident Update",
    "incident.resolved": "Incident Resolved",
  };
  const eventLabel = eventTypeLabels[event.type] || "Incident";

  // Build main message text
  const mainMessage = incident.body
    ? `${incident.body}`
    : `Incident "${incident.name}" status: ${formattedStatus}`;

  // Build fields array like monitor notifications
  const fields: Array<{ title: string; value: string; short?: boolean }> = [];

  // Status Page info
  fields.push({
    title: "Status Page",
    value: statusPageName,
    short: true,
  });

  // Incident name
  fields.push({
    title: "Incident",
    value: incident.name,
    short: true,
  });

  // Status
  fields.push({
    title: "Status",
    value: formattedStatus,
    short: true,
  });

  // Impact
  fields.push({
    title: "Impact",
    value: `${impactEmoji} ${formattedImpact}`,
    short: true,
  });

  // Time
  fields.push({
    title: "Time",
    value: new Date(event.timestamp).toUTCString(),
    short: true,
  });

  // Affected Components
  if (affectedComponents && affectedComponents.length > 0) {
    fields.push({
      title: "Affected Services",
      value: affectedComponents.join(", "),
      short: false,
    });
  }

  // Status page link
  fields.push({
    title: "🔗 Status Page",
    value: statusPageUrl,
    short: false,
  });

  // Return Slack message payload using attachment format with fields
  // This matches the format used by monitor notifications
  return {
    text: `${statusEmoji} ${eventLabel} - ${incident.name}`,
    attachments: [
      {
        color,
        text: mainMessage,
        fields,
        footer: statusPageName,
        ts: Math.floor(new Date(event.timestamp).getTime() / 1000),
      },
    ],
  };
}

/**
 * Deliver Slack message to webhook URL with retry logic
 *
 * @param webhookUrl - Slack webhook URL to deliver to
 * @param event - Incident event data
 * @returns Result of delivery attempt
 */
export async function deliverSlackMessage(
  webhookUrl: string,
  event: SlackIncidentEvent
): Promise<SlackDeliveryResult> {
  // Validate webhook URL
  try {
    const url = new URL(webhookUrl);
    if (!url.hostname.endsWith(".slack.com")) {
      return {
        success: false,
        error: "Invalid Slack webhook URL (must be a slack.com domain)",
        retriesAttempted: 0,
      };
    }
  } catch {
    return {
      success: false,
      error: "Invalid webhook URL format",
      retriesAttempted: 0,
    };
  }

  const payload = formatSlackMessage(event);
  const body = JSON.stringify(payload);

  let lastError: string | undefined;
  let lastStatusCode: number | undefined;

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt <= SLACK_CONFIG.MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Supercheck/1.0 (Slack Notification)",
        },
        body,
        signal: AbortSignal.timeout(SLACK_CONFIG.TIMEOUT_MS),
      });

      lastStatusCode = response.status;

      // Check if response was successful
      if (SLACK_CONFIG.SUCCESS_STATUS_CODES.includes(response.status)) {
        return {
          success: true,
          statusCode: response.status,
          retriesAttempted: attempt,
        };
      }

      // Non-success status code
      const responseText = await response.text();
      lastError = `HTTP ${response.status}: ${responseText}`;

      // Don't retry on 4xx errors (client errors) unless it's 429 (rate limit)
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
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
    if (attempt < SLACK_CONFIG.MAX_RETRIES) {
      const delayMs = Math.min(
        SLACK_CONFIG.INITIAL_DELAY_MS * Math.pow(2, attempt),
        SLACK_CONFIG.MAX_DELAY_MS
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
    error: `Failed after ${SLACK_CONFIG.MAX_RETRIES + 1} attempts. Last error: ${lastError}`,
    retriesAttempted: SLACK_CONFIG.MAX_RETRIES + 1,
  };
}

/**
 * Should subscriber be quarantined based on failure count?
 */
export function shouldQuarantine(failureCount: number): boolean {
  return failureCount >= SLACK_CONFIG.FAILURE_THRESHOLD;
}

/**
 * Get human-readable event description
 */
export function getSlackEventDescription(event: SlackIncidentEvent): string {
  const descriptions = {
    "incident.created": `New incident: ${event.incident.name}`,
    "incident.updated": `Incident update: ${event.incident.name}`,
    "incident.resolved": `Incident resolved: ${event.incident.name}`,
  };
  return descriptions[event.type];
}
