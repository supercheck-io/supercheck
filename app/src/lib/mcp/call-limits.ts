import { apiKeyRateLimiter } from "@/lib/api-key-rate-limiter";

/** JSON-RPC messages one connected app (token) may send per minute; a batch of N counts as N. */
export const MCP_MESSAGES_PER_MINUTE = 300;
/**
 * JSON-RPC messages per minute for all of one user's connected apps together. Dynamic client registration lets a
 * user create any number of apps, so a per-app limit alone would let them multiply their quota.
 */
export const MCP_USER_MESSAGES_PER_MINUTE = 600;
/** Largest JSON-RPC batch accepted in one POST. */
export const MCP_MAX_BATCH = 20;
/** Requests one connected app may have in flight on this instance at once. */
export const MCP_MAX_CONCURRENT = 4;
/** Requests one user may have in flight on this instance across all of their apps. */
export const MCP_USER_MAX_CONCURRENT = 8;

// Per process: with several replicas the effective caps are these values times the replica count.
const inFlight = new Map<string, number>();

export type McpCallPermit = { release: () => void };
export type McpCallRefusal = {
  status: 400 | 429 | 503;
  error: string;
  retryAfter?: number;
};
/** Whose call it is: the user, and the connected app (OAuth client) acting for them. */
export type McpCallSubject = { user: string; client: string };

export class McpBodyTooLargeError extends Error {}

/**
 * Reads the request body once, refusing to buffer more than `maxBytes` even when the client
 * sends no Content-Length. Returns the parsed JSON, or `undefined` when it is not JSON (the
 * transport then rejects the request itself).
 */
export async function readMcpBody(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new McpBodyTooLargeError();
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

/** How many JSON-RPC messages a parsed body carries; 1 when it is not an array. */
export function countMcpMessages(body: unknown): number {
  return Array.isArray(body) ? body.length : 1;
}

/**
 * Admits one MCP POST for a user's connected app, or says why not. Every authenticated call runs several
 * queries and writes, so without this one token could batch a hundred of them. The caller must call
 * `release()` when the request finishes.
 *
 * A limiter outage is its own refusal (503): Redis being down is not the caller exceeding a quota, and it
 * must not be reported as one. It still refuses, so an outage cannot lift the limit.
 */
export async function admitMcpCall(
  subject: McpCallSubject,
  messages: number,
): Promise<McpCallPermit | McpCallRefusal> {
  if (messages > MCP_MAX_BATCH) return { status: 400, error: "batch_too_large" };

  const slots = [
    { key: `user:${subject.user}`, max: MCP_USER_MAX_CONCURRENT },
    { key: `client:${subject.user}:${subject.client}`, max: MCP_MAX_CONCURRENT },
  ];
  if (slots.some(({ key, max }) => (inFlight.get(key) ?? 0) >= max)) {
    return { status: 429, error: "too_many_concurrent_requests", retryAfter: 1 };
  }
  for (const { key } of slots) inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const { key } of slots) {
      const remaining = (inFlight.get(key) ?? 1) - 1;
      if (remaining <= 0) inFlight.delete(key);
      else inFlight.set(key, remaining);
    }
  };

  // Each bucket is one atomic call for the whole batch, so a batch is admitted entirely or refused. The
  // narrower app bucket goes first, so an app that is flooding is refused there without spending the user's
  // shared quota and starving that user's other apps. If the user bucket then refuses, the app bucket has been
  // charged for a batch that did not run, which only errs towards refusing sooner.
  const buckets = [
    { key: `mcp:call:${subject.user}:${subject.client}`, maxRequests: MCP_MESSAGES_PER_MINUTE },
    { key: `mcp:user:${subject.user}`, maxRequests: MCP_USER_MESSAGES_PER_MINUTE },
  ];
  try {
    for (const { key, maxRequests } of buckets) {
      const limit = await apiKeyRateLimiter.checkAndIncrement(
        key,
        { enabled: true, timeWindow: 60, maxRequests },
        Math.max(1, messages),
      );
      if (limit.unavailable) {
        release();
        return { status: 503, error: "rate_limiter_unavailable", retryAfter: 5 };
      }
      if (!limit.allowed) {
        release();
        return { status: 429, error: "rate_limited", retryAfter: limit.retryAfter ?? 60 };
      }
    }
  } catch (error) {
    release();
    throw error;
  }
  return { release };
}

export function isMcpRefusal(value: McpCallPermit | McpCallRefusal): value is McpCallRefusal {
  return "error" in value;
}
