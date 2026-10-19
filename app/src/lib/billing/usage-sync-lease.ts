import { randomUUID } from "node:crypto";
import { getRedisConnection } from "@/lib/queue";

const KEY = "billing:usage-sync:lease";
const TTL_MS = 60_000;
const OWNED = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call(ARGV[2], KEYS[1], unpack(ARGV, 3)) else return 0 end";

/** Keep provider calls out of database transactions, with owner-checked renewal. */
export async function withUsageSyncLease<T>(run: (assertOwned: () => void) => Promise<T>): Promise<T | null> {
  const redis = await getRedisConnection();
  const owner = randomUUID();
  if (await redis.set(KEY, owner, "PX", TTL_MS, "NX") !== "OK") return null;
  let lost = false;
  let expiresAt = Date.now() + TTL_MS;
  const renewal = setInterval(() => {
    const renewedUntil = Date.now() + TTL_MS;
    void redis.eval(OWNED, 1, KEY, owner, "pexpire", String(TTL_MS))
      .then((renewed) => { if (renewed !== 1) lost = true; else expiresAt = renewedUntil; })
      .catch(() => { lost = true; });
  }, TTL_MS / 3);
  renewal.unref();
  try {
    return await run(() => { if (lost || Date.now() >= expiresAt) throw new Error("Usage sync lease lost; retry next cycle"); });
  } finally {
    clearInterval(renewal);
    await redis.eval(OWNED, 1, KEY, owner, "del").catch(() => {});
  }
}
