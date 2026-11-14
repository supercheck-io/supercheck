import { getClientIP } from "@/lib/session-security";
import { createLogger } from "@/lib/logger/index";
import { hashHeartbeatToken, isHeartbeatTokenFormat } from "./token";
import { checkHeartbeatRateLimit } from "./rate-limit";
import { recordHeartbeatPing, type HeartbeatPingKind } from "./ping";

const logger = createLogger({ module: "heartbeat-ping" }) as {
  warn: (data: unknown, msg?: string) => void;
};

export const HEARTBEAT_MAX_BODY_BYTES = 10_000;

const OK_HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

function respond(request: Request, status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(request.method === "HEAD" ? null : body, { status, headers: { ...OK_HEADERS, ...extra } });
}

/**
 * Public heartbeat ping (spec 4.3). Every outcome that is not a rate limit or an oversized body
 * answers the same `200 OK`, so a caller cannot tell a valid token from an invalid one (D16).
 * The body is never read. The token itself is never logged.
 */
export async function handleHeartbeatPing(request: Request, token: string, kind: HeartbeatPingKind): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > HEARTBEAT_MAX_BODY_BYTES) return respond(request, 413, "Payload Too Large");
  if (!isHeartbeatTokenFormat(token)) return respond(request, 200, "OK");

  const tokenHash = hashHeartbeatToken(token);
  const limit = await checkHeartbeatRateLimit(tokenHash, getClientIP(request.headers));
  if (!limit.allowed) {
    return respond(request, 429, "Too Many Requests", { "Retry-After": String(limit.retryAfterSeconds) });
  }

  try {
    await recordHeartbeatPing(tokenHash, kind, request.headers.get("user-agent"));
  } catch (error) {
    // A DB error must not reveal anything either; the hash prefix is enough to correlate.
    logger.warn(
      { tokenHashPrefix: tokenHash.slice(0, 8), error: error instanceof Error ? error.message : String(error) },
      "Heartbeat ping not recorded",
    );
    return respond(request, 503, "Service Unavailable", { "Retry-After": "5" });
  }
  return respond(request, 200, "OK");
}
