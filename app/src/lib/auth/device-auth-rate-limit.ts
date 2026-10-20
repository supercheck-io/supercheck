import { createHash, randomUUID } from "node:crypto";
import { getRedisConnection } from "@/lib/queue";

const WINDOW_MS = 10 * 60 * 1000;

export interface DeviceAuthLimit {
  scope: string;
  /** Identifier hashed before use so IPs / codes never appear in Redis keys. */
  subject: string;
  max: number;
}

export const DEVICE_AUTH_LIMITS = {
  codeIssuePerIp: (ip: string): DeviceAuthLimit => ({
    scope: "code-ip",
    subject: ip,
    // Without a trustworthy client IP everyone shares one bucket; keep it generous
    // and rely on the global cap so one caller cannot lock the instance out.
    max: ip === "unknown" ? 120 : 10,
  }),
  codeIssueGlobal: (): DeviceAuthLimit => ({
    scope: "code-global",
    subject: "all",
    max: 600,
  }),
  tokenPollPerDevice: (deviceCodeHash: string): DeviceAuthLimit => ({
    scope: "token-device",
    subject: deviceCodeHash,
    max: 240,
  }),
  tokenPollPerIp: (ip: string): DeviceAuthLimit => ({
    scope: "token-ip",
    subject: ip,
    max: ip === "unknown" ? 6000 : 600,
  }),
  verifyPerUser: (userId: string): DeviceAuthLimit => ({
    scope: "verify-user",
    subject: userId,
    max: 20,
  }),
  verifyPerIp: (ip: string): DeviceAuthLimit => ({
    scope: "verify-ip",
    subject: ip,
    max: ip === "unknown" ? 600 : 60,
  }),
} as const;

/**
 * Sliding-window limiter shared across replicas via Redis. Fails CLOSED: if
 * Redis is unreachable the request is rejected rather than allowed, because
 * these endpoints guard credential issuance.
 */
export async function allowDeviceAuthRequest(
  limits: DeviceAuthLimit[],
): Promise<boolean> {
  try {
    const redis = await getRedisConnection();
    const keys = limits.map(
      (l) =>
        `supercheck:{device-auth}:${l.scope}:${createHash("sha256")
          .update(l.subject)
          .digest("hex")
          .slice(0, 32)}`,
    );
    const result = await redis.eval(
      `
      local now = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      for i, key in ipairs(KEYS) do
        redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
        if redis.call('ZCARD', key) >= tonumber(ARGV[2 + i]) then return 0 end
      end
      for _, key in ipairs(KEYS) do
        redis.call('ZADD', key, now, ARGV[2 + #KEYS + 1])
        redis.call('PEXPIRE', key, window)
      end
      return 1
    `,
      keys.length,
      ...keys,
      Date.now(),
      WINDOW_MS,
      ...limits.map((l) => l.max),
      randomUUID(),
    );
    return Number(result) === 1;
  } catch {
    return false;
  }
}
