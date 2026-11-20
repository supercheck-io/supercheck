import { createHash } from "node:crypto";
import type { BetterAuthOptions } from "better-auth";
import { getRedisConnection } from "@/lib/queue";
import { withRedisDeadline } from "@/lib/security/redis-deadline";
import { getClientIP, UNKNOWN_CLIENT_IP } from "@/lib/session-security";

/** Request header carrying the client IP resolved with the app's proxy-trust rules; Better Auth reads only this. */
export const AUTH_CLIENT_IP_HEADER = "x-supercheck-client-ip";

/**
 * Rebuilds the request so Better Auth sees the trusted client IP. Any client-sent copy of the header is dropped,
 * and without a trustworthy IP the header is absent (Better Auth then uses one shared bucket per path).
 */
export function withAuthClientIp(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(AUTH_CLIENT_IP_HEADER);
  const ip = getClientIP(request.headers);
  if (ip !== UNKNOWN_CLIENT_IP) headers.set(AUTH_CLIENT_IP_HEADER, ip);
  return new Request(request, { headers });
}

type RateLimitStorage = NonNullable<NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]>;

const INCREMENT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}
`;

/**
 * Fixed-window store shared by all replicas (the default in-memory store multiplies every limit by the replica
 * count). Fails open: these rules front every /api/auth call, including get-session, and the credential endpoints
 * keep their own fail-closed Redis lockout and Turnstile.
 */
export const betterAuthRateLimitStorage: RateLimitStorage = {
  async consume(key, rule) {
    try {
      const redis = await getRedisConnection();
      // Keys carry the client IP; hash them so addresses never appear in Redis.
      const redisKey = `supercheck:auth-rl:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
      const [count, ttl] = (await withRedisDeadline(redis, () =>
        redis.eval(INCREMENT, 1, redisKey, rule.window),
      )) as [number, number];
      if (count <= rule.max) return { allowed: true, retryAfter: null };
      return { allowed: false, retryAfter: ttl > 0 ? ttl : rule.window };
    } catch (error) {
      console.warn("Auth rate limit unavailable; allowing request:", error instanceof Error ? error.message : error);
      return { allowed: true, retryAfter: null };
    }
  },
};
