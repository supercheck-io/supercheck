import { createHash, randomUUID } from "node:crypto";
import { getRedisConnection } from "./queue";

export async function allowStatusPageSubscription(
  ip: string,
  pageId: string,
): Promise<boolean> {
  try {
    const redis = await getRedisConnection();
    const client = createHash("sha256").update(ip).digest("hex");
    const now = Date.now();
    const result = await redis.eval(
      `
      local keys = KEYS
      local limits = {5, 120}
      for i, key in ipairs(keys) do
        redis.call('ZREMRANGEBYSCORE', key, 0, ARGV[1] - 600000)
        if redis.call('ZCARD', key) >= limits[i] then return 0 end
      end
      for _, key in ipairs(keys) do
        redis.call('ZADD', key, ARGV[1], ARGV[2])
        redis.call('PEXPIRE', key, 600000)
      end
      return 1
    `,
      2,
      `supercheck:status-subscribe:client:${pageId}:${client}`,
      `supercheck:status-subscribe:page:${pageId}`,
      now,
      randomUUID(),
    );
    return Number(result) === 1;
  } catch {
    return false;
  }
}
