import { createHash, randomUUID } from "node:crypto";
import { getRedisConnection } from "@/lib/queue";

export const HEARTBEAT_TOKEN_LIMIT_PER_MINUTE = 10;
// High on purpose: many jobs often share one NAT address, and a dropped ping is a false "missed" alert.
// The 128-bit token stops guessing; this only bounds load from one address.
export const HEARTBEAT_IP_LIMIT_PER_MINUTE = 1200;

export type HeartbeatRateLimitResult =
  /** `release` gives the slot back, for a ping that was not recorded (so a client retry does not cost twice). */
  | { allowed: true; release: () => Promise<void> }
  | { allowed: false; retryAfterSeconds: number };

const NOOP_RELEASE = async () => {};

/**
 * Sliding one-minute windows per token hash and per client IP hash. Fails OPEN when Redis is
 * unavailable: dropping a real ping would raise a false "missed run" alert (spec 4.3).
 */
export async function checkHeartbeatRateLimit(tokenHash: string, clientIp: string | null): Promise<HeartbeatRateLimitResult> {
  try {
    const redis = await getRedisConnection();
    // Unknown client IP (no trusted proxy header): skip the IP window, or every such caller across
    // all customers would share one bucket and real pings would be dropped. The token limit still applies.
    const ipKey = clientIp
      ? `supercheck:heartbeat:rl:ip:${createHash("sha256").update(clientIp).digest("hex")}`
      : `supercheck:heartbeat:rl:ip:none:${tokenHash}`;
    const now = Date.now();
    const member = randomUUID();
    const tokenKey = `supercheck:heartbeat:rl:token:${tokenHash}`;
    const result = await redis.eval(
      `
      local limits = {tonumber(ARGV[3]), tonumber(ARGV[4])}
      for i, key in ipairs(KEYS) do
        redis.call('ZREMRANGEBYSCORE', key, 0, ARGV[1] - 60000)
        if redis.call('ZCARD', key) >= limits[i] then
          local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
          return {0, oldest[2] or ARGV[1]}
        end
      end
      for _, key in ipairs(KEYS) do
        redis.call('ZADD', key, ARGV[1], ARGV[2])
        redis.call('PEXPIRE', key, 60000)
      end
      return {1, 0}
    `,
      2,
      tokenKey,
      ipKey,
      now,
      member,
      HEARTBEAT_TOKEN_LIMIT_PER_MINUTE,
      HEARTBEAT_IP_LIMIT_PER_MINUTE,
    );
    const [allowed, oldest] = (result as [number, number | string]) ?? [1, 0];
    if (Number(allowed) === 1) {
      return {
        allowed: true,
        release: async () => {
          await Promise.all([redis.zrem(tokenKey, member), redis.zrem(ipKey, member)]).catch(() => undefined);
        },
      };
    }
    const retryAfterMs = Number(oldest) + 60_000 - now;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  } catch {
    return { allowed: true, release: NOOP_RELEASE };
  }
}
