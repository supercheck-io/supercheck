/**
 * Worker Registry — App-side module to read worker heartbeat data from Redis.
 *
 * Workers send periodic heartbeats to Redis keys with TTL.
 * This module scans those keys to determine which locations have active workers.
 */
import { getRedisConnection } from "@/lib/queue";

const HEARTBEAT_PREFIX = "supercheck:worker-heartbeat:";

export interface ActiveWorker {
  id: string;
  location: string;
  hostname: string;
  startedAt: string;
  lastHeartbeat: string;
  queues: string[];
  pid: number;
}

/**
 * Get all active workers from Redis heartbeat keys.
 * Keys auto-expire after 60s, so only live workers appear.
 */
export async function getActiveWorkers(): Promise<ActiveWorker[]> {
  const redis = await getRedisConnection();
  const workers: ActiveWorker[] = [];

  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${HEARTBEAT_PREFIX}*`,
      "COUNT",
      100
    );
    cursor = nextCursor;

    if (keys.length === 0) continue;

    const pipeline = redis.pipeline();
    for (const key of keys) {
      pipeline.get(key);
    }
    const results = await pipeline.exec();

    if (results) {
      for (let i = 0; i < keys.length; i++) {
        const [err, value] = results[i] as [Error | null, string | null];
        if (err || !value) continue;
        try {
          const data = JSON.parse(value);
          workers.push({
            id: keys[i].replace(HEARTBEAT_PREFIX, ""),
            location: data.location,
            hostname: data.hostname,
            startedAt: data.startedAt,
            lastHeartbeat: data.lastHeartbeat,
            queues: data.queues || [],
            pid: data.pid,
          });
        } catch {
          // Skip malformed entries
        }
      }
    }
  } while (cursor !== "0");

  return workers;
}

/**
 * Aggregate worker count by location code.
 */
export async function getWorkerCountByLocation(): Promise<
  Record<string, number>
> {
  const workers = await getActiveWorkers();
  const counts: Record<string, number> = {};
  for (const w of workers) {
    counts[w.location] = (counts[w.location] || 0) + 1;
  }
  return counts;
}

/**
 * Get location codes that have active workers but are NOT in the DB.
 * Used for "unregistered worker" alerts in Super Admin.
 */
export async function getUnregisteredWorkerLocations(
  knownCodes: Set<string>
): Promise<string[]> {
  const workers = await getActiveWorkers();
  const unregistered = new Set<string>();
  for (const w of workers) {
    if (!knownCodes.has(w.location) && w.location !== "local") {
      unregistered.add(w.location);
    }
  }
  return Array.from(unregistered);
}
