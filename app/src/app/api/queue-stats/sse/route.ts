import { NextRequest } from "next/server";
import { getQueueStats } from "@/lib/queue-stats";
import { getActiveOrganization } from "@/lib/session";

// SSE Best Practices Configuration
const SSE_CONFIG = {
  // Initial polling interval (1 second)
  INITIAL_INTERVAL_MS: 1000,
  // Maximum polling interval after backoff (10 seconds)
  MAX_INTERVAL_MS: 10000,
  // Backoff multiplier when no changes detected
  BACKOFF_MULTIPLIER: 1.5,
  // Maximum connection duration (5 minutes) - client should reconnect
  MAX_CONNECTION_DURATION_MS: 5 * 60 * 1000,
  // Heartbeat interval to keep connection alive (30 seconds)
  HEARTBEAT_INTERVAL_MS: 30 * 1000,
};

// Helper to create SSE messages
const encoder = new TextEncoder();
function createSSEMessage<T>(data: T) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function createSSEComment(comment: string) {
  return `: ${comment}\n\n`;
}

export async function GET(request: NextRequest) {
  // Get the active organization for plan-specific capacity limits
  // This is non-blocking - if no org, we'll use defaults
  let organizationId: string | undefined;
  try {
    const activeOrg = await getActiveOrganization();
    organizationId = activeOrg?.id;
  } catch {
    // Ignore auth errors - will use default capacity limits
  }

  // Set up response headers for SSE
  const responseHeaders = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Hint to client for reconnection (in milliseconds)
    "X-SSE-Reconnect-After": String(SSE_CONFIG.MAX_CONNECTION_DURATION_MS),
  };

  const stream = new ReadableStream({
    async start(controller) {
      let aborted = false;
      let currentInterval = SSE_CONFIG.INITIAL_INTERVAL_MS;
      let lastStats: string | null = null;
      let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
      let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
      const connectionStartTime = Date.now();

      // Cleanup function
      const cleanup = () => {
        aborted = true;
        if (pollTimeoutId) {
          clearTimeout(pollTimeoutId);
          pollTimeoutId = null;
        }
        if (heartbeatIntervalId) {
          clearInterval(heartbeatIntervalId);
          heartbeatIntervalId = null;
        }
        try {
          controller.close();
        } catch {
          // Ignore errors when closing
        }
      };

      // Setup abort handling
      request.signal.addEventListener("abort", cleanup);

      // Function to send queue stats with org-specific limits
      const sendStats = async () => {
        if (aborted) return;

        try {
          const stats = await getQueueStats(organizationId);
          const statsJson = JSON.stringify(stats);

          // Adaptive polling: if stats haven't changed, increase interval
          if (statsJson === lastStats) {
            currentInterval = Math.min(
              currentInterval * SSE_CONFIG.BACKOFF_MULTIPLIER,
              SSE_CONFIG.MAX_INTERVAL_MS
            );
          } else {
            // Stats changed, reset to faster polling
            currentInterval = SSE_CONFIG.INITIAL_INTERVAL_MS;
            lastStats = statsJson;
          }

          const message = createSSEMessage(stats);
          controller.enqueue(encoder.encode(message));
        } catch {
          // Suppress detailed error logging to reduce noise
        }
      };

      // Check if we should close the connection (max duration reached)
      const checkMaxDuration = () => {
        const elapsed = Date.now() - connectionStartTime;
        if (elapsed >= SSE_CONFIG.MAX_CONNECTION_DURATION_MS) {
          // Send a reconnect hint to the client
          try {
            const reconnectMessage = createSSEMessage({
              type: "reconnect",
              message: "Connection duration limit reached. Please reconnect.",
              reconnectAfterMs: 100,
            });
            controller.enqueue(encoder.encode(reconnectMessage));
          } catch {
            // Ignore errors
          }
          cleanup();
          return true;
        }
        return false;
      };

      // Send initial stats
      await sendStats();

      // Set up heartbeat to keep connection alive
      heartbeatIntervalId = setInterval(() => {
        if (aborted) return;
        try {
          // Send SSE comment as heartbeat (doesn't trigger events on client)
          controller.enqueue(encoder.encode(createSSEComment("heartbeat")));
        } catch {
          cleanup();
        }
      }, SSE_CONFIG.HEARTBEAT_INTERVAL_MS);

      // Adaptive polling function using setTimeout for variable intervals
      const schedulePoll = () => {
        if (aborted) return;

        // Check max connection duration
        if (checkMaxDuration()) return;

        pollTimeoutId = setTimeout(async () => {
          if (aborted) return;
          await sendStats();
          schedulePoll(); // Schedule next poll with potentially updated interval
        }, currentInterval);
      };

      // Start the polling loop
      schedulePoll();
    },
  });

  return new Response(stream, {
    headers: responseHeaders,
  });
}
