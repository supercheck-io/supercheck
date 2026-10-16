import { sql } from 'drizzle-orm';

export type LocationWorkload = 'browser' | 'k6';

/** Minimal shape of the DbService used for capability reads (keeps this unit-testable). */
interface CapabilityDb {
  db: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };
}

interface CacheEntry {
  supportsBrowser: boolean;
  supportsK6: boolean;
  expiresAt: number;
}

/**
 * Capability changes made in Super Admin reach workers within this window.
 * Routine disablement should drain work first; this bounds the emergency case.
 */
export const CAPABILITY_CACHE_TTL_MS = 10_000;

const cache = new Map<string, CacheEntry>();

export function clearLocationCapabilityCache(): void {
  cache.clear();
}

/** Postgres undefined_column. Drizzle may wrap the driver error in `cause`. */
export function isMissingCapabilityColumnError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    const { code, message, cause } = current as {
      code?: string;
      message?: string;
      cause?: unknown;
    };
    if (
      code === '42703' &&
      /supports_(browser|k6)/.test(message ?? 'supports_browser')
    ) {
      return true;
    }
    current = cause;
  }
  return false;
}

/**
 * Whether the location currently supports the workload.
 *
 * - Row found: returns its flag.
 * - Row missing (location deleted): returns false.
 * - DB error: throws, so callers fail retryably. Unknown capability is never
 *   treated as allowed.
 */
export async function locationSupportsWorkload(
  dbService: CapabilityDb,
  code: string,
  workload: LocationWorkload,
): Promise<boolean> {
  const key = code.toLowerCase();
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return workload === 'browser' ? cached.supportsBrowser : cached.supportsK6;
  }

  let rows: Array<{ supports_browser: boolean; supports_k6: boolean }>;
  try {
    rows = (await dbService.db.execute(
      sql`SELECT supports_browser, supports_k6 FROM locations WHERE code = ${key} AND is_enabled = true LIMIT 1`,
    )) as Array<{ supports_browser: boolean; supports_k6: boolean }>;
  } catch (error) {
    // Worker rolled out before migration 0029: every location was capable then.
    // Any other failure is "unknown" and must not be treated as allowed.
    if (!isMissingCapabilityColumnError(error)) throw error;
    return true;
  }

  const row = rows[0];
  if (!row) {
    cache.delete(key);
    return false;
  }
  const entry: CacheEntry = {
    supportsBrowser: row.supports_browser,
    supportsK6: row.supports_k6,
    expiresAt: now + CAPABILITY_CACHE_TTL_MS,
  };
  cache.set(key, entry);
  return workload === 'browser' ? entry.supportsBrowser : entry.supportsK6;
}

/**
 * Whether the worker's OWN location may run a workload from the location-less
 * global queues. Only an explicit `false` denies: a location with no row (for
 * example an unregistered self-hosted location) or a database that predates
 * migration 0029 keeps today's behaviour. A DB error throws; callers keep their
 * current state instead of guessing.
 */
export async function workerLocationAllowsWorkload(
  dbService: CapabilityDb,
  location: string,
  workload: LocationWorkload,
): Promise<boolean> {
  const column = workload === 'browser' ? 'supports_browser' : 'supports_k6';
  try {
    const rows = (await dbService.db.execute(
      sql`SELECT supports_browser, supports_k6 FROM locations WHERE code = ${location.toLowerCase()} LIMIT 1`,
    )) as Array<{ supports_browser: boolean; supports_k6: boolean }>;
    const row = rows[0];
    return row ? row[column] !== false : true;
  } catch (error) {
    if (isMissingCapabilityColumnError(error)) return true;
    throw error;
  }
}
