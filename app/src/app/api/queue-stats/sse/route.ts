import { NextRequest } from "next/server";
import { getQueueStats } from "@/lib/queue-stats";
import { getActiveOrganization } from "@/lib/session";
import { getRedisConnection, QUEUE_STATS_UPDATE_CHANNEL } from "@/lib/queue";
import { Redis } from "ioredis";

// SSE Configuration
const SSE_CONFIG = {
  // Maximum connection duration (5 minutes) - client should reconnect
  MAX_CONNECTION_DURATION_MS: 5 * 60 * 1000,
  // Heartbeat interval to keep connection alive (30 seconds)
  HEARTBEAT_INTERVAL_MS: 30 * 1000,
  // Periodic reconciliation interval (60 seconds) - catches any missed pub/sub messages
  RECONCILIATION_INTERVAL_MS: 60 * 1000,
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
    "X-SSE-Reconnect-After": String(SSE_CONFIG.MAX_CONNECTION_DURATION_MS),
  };

  const stream = new ReadableStream({
    async start(controller) {
      let aborted = false;
      let lastStats: string | null = null;
      let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
      let reconciliationIntervalId: ReturnType<typeof setInterval> | null = null;
      let subscriber: Redis | null = null;
      const connectionStartTime = Date.now();

      // Cleanup function
      const cleanup = () => {
        aborted = true;
        if (heartbeatIntervalId) {
          clearInterval(heartbeatIntervalId);
          heartbeatIntervalId = null;
        }
        if (reconciliationIntervalId) {
          clearInterval(reconciliationIntervalId);
          reconciliationIntervalId = null;
        }
        if (subscriber) {
          subscriber.quit().catch(() => {});
          subscriber = null;
        }
        try {
          controller.close();
        } catch {
          // Ignore errors when closing
        }
      };

      // Setup abort handling
      request.signal.addEventListener("abort", cleanup);

      // Function to send queue stats (only sends if changed)
      const sendStats = async (force = false) => {
        if (aborted) return;

        try {
          const stats = await getQueueStats(organizationId);
          const statsJson = JSON.stringify(stats);

          // Only send if stats have changed or forced
          if (force || statsJson !== lastStats) {
            lastStats = statsJson;
            const message = createSSEMessage(stats);
            controller.enqueue(encoder.encode(message));
          }
        } catch {
          // Suppress errors to avoid noise
        }
      };

      // Check if we should close the connection (max duration reached)
      const checkMaxDuration = () => {
        const elapsed = Date.now() - connectionStartTime;
        if (elapsed >= SSE_CONFIG.MAX_CONNECTION_DURATION_MS) {
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

      // Set up Redis subscription for real-time updates
      try {
        const redis = await getRedisConnection();
        subscriber = redis.duplicate();

        subscriber.on("message", (channel) => {
          if (channel === QUEUE_STATS_UPDATE_CHANNEL) {
            // Immediately fetch and send updated stats
            sendStats(true);
          }
        });

        await subscriber.subscribe(QUEUE_STATS_UPDATE_CHANNEL);
      } catch (err) {
        console.error("Failed to set up Redis subscription for SSE:", err);
        // Without pub/sub, fall back to periodic reconciliation only
      }

      // Send initial stats
      await sendStats(true);

      // Set up heartbeat to keep connection alive
      heartbeatIntervalId = setInterval(() => {
        if (aborted) return;
        try {
          controller.enqueue(encoder.encode(createSSEComment("heartbeat")));
        } catch {
          cleanup();
        }
      }, SSE_CONFIG.HEARTBEAT_INTERVAL_MS);

      // Set up periodic reconciliation to catch any missed pub/sub messages
      reconciliationIntervalId = setInterval(async () => {
        if (aborted) return;
        if (checkMaxDuration()) return;
        await sendStats(); // Only sends if stats changed
      }, SSE_CONFIG.RECONCILIATION_INTERVAL_MS);
    },
  });

  return new Response(stream, {
    headers: responseHeaders,
  });
}

