/**
 * Worker Registry — App-side module to read worker heartbeat data from Redis.
 *
 * Workers send periodic heartbeats to Redis keys with TTL.
 * This module scans those keys to determine which locations have active workers.
 */
import { getRedisConnection } from "@/lib/queue";
import {
  LOCAL_LOCATION_CODE,
  shouldExcludeLocal,
} from "@/lib/location-registry";

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

// Short cache so scheduler ticks and manual runs share one keyspace SCAN. Heartbeat keys live 60s, so 5s staleness is harmless.
const ACTIVE_WORKERS_CACHE_TTL_MS = 5_000;
let cachedWorkers: { at: number; workers: ActiveWorker[] } | null = null;
let inflightScan: Promise<ActiveWorker[]> | null = null;

/**
 * Get all active workers from Redis heartbeat keys.
 * Keys auto-expire after 60s, so only live workers appear.
 * Results are cached for 5s and concurrent callers share one scan; errors are never cached.
 */
export async function getActiveWorkers(): Promise<ActiveWorker[]> {
  // age >= 0: a wall-clock step backwards must expire the snapshot, not extend it.
  const age = cachedWorkers ? Date.now() - cachedWorkers.at : -1;
  if (cachedWorkers && age >= 0 && age < ACTIVE_WORKERS_CACHE_TTL_MS) {
    return cachedWorkers.workers;
  }
  inflightScan ??= scanActiveWorkers()
    .then((workers) => {
      cachedWorkers = { at: Date.now(), workers };
      return workers;
    })
    .finally(() => {
      inflightScan = null;
    });
  return inflightScan;
}

async function scanActiveWorkers(): Promise<ActiveWorker[]> {
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

export async function getActiveWorkerQueueNames(): Promise<Set<string>> {
  const workers = await getActiveWorkers();
  const queueNames = new Set<string>();

  for (const worker of workers) {
    for (const queueName of worker.queues || []) {
      if (queueName) {
        queueNames.add(queueName);
      }
    }
  }

  return queueNames;
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

export function shouldReportUnregisteredWorkerLocation(
  location: string,
  knownCodes: Set<string>
): boolean {
  if (knownCodes.has(location)) {
    return false;
  }

  if (location !== LOCAL_LOCATION_CODE) {
    return true;
  }

  return shouldExcludeLocal();
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
    if (shouldReportUnregisteredWorkerLocation(w.location, knownCodes)) {
      unregistered.add(w.location);
    }
  }
  return Array.from(unregistered);
}
