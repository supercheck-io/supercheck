import { apiKeyRateLimiter } from "@/lib/api-key-rate-limiter";

/** JSON-RPC messages one token may send per minute; a batch of N counts as N. */
export const MCP_MESSAGES_PER_MINUTE = 300;
/** Largest JSON-RPC batch accepted in one POST. */
export const MCP_MAX_BATCH = 20;
/** Requests one token may have in flight on this instance at once. */
export const MCP_MAX_CONCURRENT = 4;

// Per process: with several replicas the effective cap is this value times the replica count.
const inFlight = new Map<string, number>();

export type McpCallPermit = { release: () => void };
export type McpCallRefusal = { status: 400 | 429; error: string; retryAfter?: number };

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
 * Admits one MCP POST for a token (user + client), or says why not. Every authenticated call
 * runs several queries and writes, so without this one token could batch a hundred of them.
 * The caller must call `release()` when the request finishes.
 */
export async function admitMcpCall(
  key: string,
  messages: number,
): Promise<McpCallPermit | McpCallRefusal> {
  if (messages > MCP_MAX_BATCH) return { status: 400, error: "batch_too_large" };

  const active = inFlight.get(key) ?? 0;
  if (active >= MCP_MAX_CONCURRENT) return { status: 429, error: "too_many_concurrent_requests", retryAfter: 1 };
  inFlight.set(key, active + 1);
  const release = () => {
    const remaining = (inFlight.get(key) ?? 1) - 1;
    if (remaining <= 0) inFlight.delete(key);
    else inFlight.set(key, remaining);
  };

  for (let i = 0; i < Math.max(1, messages); i++) {
    const limit = await apiKeyRateLimiter
      .checkAndIncrement(`mcp:call:${key}`, { enabled: true, timeWindow: 60, maxRequests: MCP_MESSAGES_PER_MINUTE })
      .catch((error) => {
        release();
        throw error;
      });
    if (!limit.allowed) {
      release();
      return { status: 429, error: "rate_limited", retryAfter: limit.retryAfter ?? 60 };
    }
  }
  return { release };
}

export function isMcpRefusal(value: McpCallPermit | McpCallRefusal): value is McpCallRefusal {
  return "error" in value;
}
