/**
 * Request-scoped session cache using AsyncLocalStorage
 * 
 * This eliminates duplicate auth.api.getSession() calls within a single request.
 * In Docker/production, each DB round-trip adds 3-5ms latency, so caching
 * session data per-request gives significant performance improvements.
 * 
 * Usage:
 * Instead of: await auth.api.getSession({ headers: await headers() })
 * Use: await getCachedSession('auth', () => auth.api.getSession({ headers: await headers() }))
 */

import { AsyncLocalStorage } from 'async_hooks';

// Type for session cache entries
interface CacheMapEntry {
  value: unknown;
  timestamp: number;
}

// Global store for request-scoped data
const requestStore = new AsyncLocalStorage<Map<string, CacheMapEntry>>();

// Maximum age for cache entries (prevent memory leaks in long-running requests)
const MAX_CACHE_AGE_MS = 30000; // 30 seconds

/**
 * Get or set a cached value within the current request scope.
 * If no request context exists (e.g., in workers), falls back to direct execution.
 * 
 * @param key Unique cache key for this value
 * @param fetcher Async function to fetch the value if not cached
 * @returns The cached or freshly fetched value
 * 
 * @example
 * ```typescript
 * const session = await getCachedSession('auth:session', async () => {
 *   return auth.api.getSession({ headers: await headers() });
 * });
 * ```
 */
export async function getCachedSession<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const store = requestStore.getStore();
  
  // No request context - execute directly (worker mode, etc.)
  if (!store) {
    return fetcher();
  }
  
  const now = Date.now();
  const cached = store.get(key);
  
  // Return cached value if exists and not expired
  if (cached && (now - cached.timestamp) < MAX_CACHE_AGE_MS) {
    return cached.value as T;
  }
  
  // Fetch fresh value
  const result = await fetcher();
  
  // Cache it
  store.set(key, { value: result, timestamp: now });
  
  return result;
}

/**
 * Run a function with request-scoped caching enabled.
 * This should wrap each API route handler and server component.
 * 
 * @param fn The async function to run with caching enabled
 * @returns The result of the function
 * 
 * @example
 * ```typescript
 * export async function GET(request: Request) {
 *   return withRequestCache(async () => {
 *     const session = await getCachedSession('auth', () => getSession());
 *     // ... rest of handler
 *   });
 * }
 * ```
 */
export function withRequestCache<T>(fn: () => Promise<T>): Promise<T> {
  return requestStore.run(new Map(), fn);
}

/**
 * Clear all cached values for the current request.
 * Useful if you need to force fresh data mid-request.
 */
export function clearRequestCache(): void {
  const store = requestStore.getStore();
  if (store) {
    store.clear();
  }
}

/**
 * Check if we're running within a request context.
 */
export function hasRequestContext(): boolean {
  return requestStore.getStore() !== undefined;
}

// ============================================================================
// CENTRALIZED AUTH SESSION HELPER
// ============================================================================

// Lazy import to avoid circular dependencies
let authModule: typeof import('@/utils/auth') | null = null;
let headersModule: typeof import('next/headers') | null = null;

/**
 * Get cached auth session for the current request.
 * This is the SINGLE source of truth for session caching across the app.
 * 
 * Previously duplicated in: session.ts, project-context.ts, rbac/middleware.ts
 * Now centralized here to follow DRY principle.
 * 
 * @returns The auth session (cached within request scope)
 * 
 * @example
 * ```typescript
 * import { getCachedAuthSession } from '@/lib/session-cache';
 * const session = await getCachedAuthSession();
 * ```
 */
export async function getCachedAuthSession() {
  // Lazy load modules to avoid circular dependencies
  if (!authModule) {
    authModule = await import('@/utils/auth');
  }
  if (!headersModule) {
    headersModule = await import('next/headers');
  }
  
  return getCachedSession('auth:session', async () => {
    return authModule!.auth.api.getSession({
      headers: await headersModule!.headers(),
    });
  });
}
