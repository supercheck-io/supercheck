/**
 * Prefetch Utilities
 *
 * PERFORMANCE OPTIMIZATION:
 * Provides utility functions for hover-intent prefetching of page data.
 * When a user hovers over a navigation link, these functions can be called
 * to start fetching data in advance, making the subsequent navigation instant.
 *
 * Key features:
 * - Deduplication: Prevents duplicate prefetch requests for the same resource
 * - Non-blocking: All prefetches run in the background
 * - Cache-friendly: Uses React Query's prefetchQuery which respects staleTime
 * - Graceful degradation: If prefetch fails, normal fetch happens on navigation
 *
 * @example
 * ```tsx
 * // In a table row component
 * <TableRow
 *   onMouseEnter={() => prefetchTestPage(test.id, queryClient)}
 *   onClick={() => router.push(`/playground/${test.id}`)}
 * >
 * ```
 */

import type { QueryClient } from "@tanstack/react-query";
import { triggerMonacoPreload } from "@/components/monaco-prefetcher";

// ============================================================================
// INTERNAL STATE
// ============================================================================

/**
 * Tracks active prefetch operations to prevent duplicates
 * Format: "entity-id" -> timestamp when prefetch started
 */
const activePrefetches = new Map<string, number>();

/**
 * How long to keep a prefetch "active" (prevents re-prefetching)
 * Set to 30 seconds - long enough to cover most user interactions
 */
const PREFETCH_COOLDOWN_MS = 30 * 1000;

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Check if we should skip prefetching for this key
 */
function shouldSkipPrefetch(key: string): boolean {
  const lastPrefetch = activePrefetches.get(key);
  if (lastPrefetch && Date.now() - lastPrefetch < PREFETCH_COOLDOWN_MS) {
    return true;
  }
  return false;
}

/**
 * Mark a prefetch as active
 */
function markPrefetchActive(key: string): void {
  activePrefetches.set(key, Date.now());

  // Clean up old entries to prevent memory leaks
  if (activePrefetches.size > 100) {
    const now = Date.now();
    for (const [k, timestamp] of activePrefetches.entries()) {
      if (now - timestamp > PREFETCH_COOLDOWN_MS) {
        activePrefetches.delete(k);
      }
    }
  }
}

// ============================================================================
// PREFETCH FUNCTIONS
// ============================================================================

/**
 * Prefetch test page data (for playground navigation)
 *
 * Also triggers Monaco editor preload since playground uses Monaco.
 *
 * @param testId - The test ID to prefetch
 * @param queryClient - React Query client instance
 *
 * @example
 * ```tsx
 * const queryClient = useQueryClient();
 *
 * <TableRow
 *   onMouseEnter={() => prefetchTestPage(row.original.id, queryClient)}
 *   onClick={() => router.push(`/playground/${row.original.id}`)}
 * >
 * ```
 */
export function prefetchTestPage(
  testId: string,
  queryClient: QueryClient
): void {
  const key = `test-${testId}`;
  if (shouldSkipPrefetch(key)) return;
  markPrefetchActive(key);

  // Prefetch test data
  void queryClient.prefetchQuery({
    queryKey: ["test", testId],
    queryFn: async () => {
      const response = await fetch(`/api/tests/${testId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch test: ${response.status}`);
      }
      return response.json();
    },
    staleTime: 60 * 1000, // 1 minute - match useTest hook
  });

  // Also trigger Monaco preload for playground
  triggerMonacoPreload();
}

/**
 * Prefetch job page data
 *
 * @param jobId - The job ID to prefetch
 * @param queryClient - React Query client instance
 */
export function prefetchJobPage(
  jobId: string,
  queryClient: QueryClient
): void {
  const key = `job-${jobId}`;
  if (shouldSkipPrefetch(key)) return;
  markPrefetchActive(key);

  void queryClient.prefetchQuery({
    queryKey: ["job", jobId],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch job: ${response.status}`);
      }
      const data = await response.json();
      // API returns { job: {...} } for single job
      return data.job || data;
    },
    staleTime: 60 * 1000, // 1 minute - match useJob hook
  });

  // Jobs also use Monaco for test editing
  triggerMonacoPreload();
}

/**
 * Prefetch run detail page data
 *
 * @param runId - The run ID to prefetch
 * @param queryClient - React Query client instance
 */
export function prefetchRunPage(
  runId: string,
  queryClient: QueryClient
): void {
  const key = `run-${runId}`;
  if (shouldSkipPrefetch(key)) return;
  markPrefetchActive(key);

  void queryClient.prefetchQuery({
    queryKey: ["run", runId],
    queryFn: async () => {
      const response = await fetch(`/api/runs/${runId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch run: ${response.status}`);
      }
      const data = await response.json();
      return data.run || data;
    },
    staleTime: 5000, // Match useRuns configuration (5s)
  });
}

/**
 * Prefetch monitor detail page data
 *
 * @param monitorId - The monitor ID to prefetch
 * @param queryClient - React Query client instance
 */
export function prefetchMonitorPage(
  monitorId: string,
  queryClient: QueryClient
): void {
  const key = `monitor-${monitorId}`;
  if (shouldSkipPrefetch(key)) return;
  markPrefetchActive(key);

  void queryClient.prefetchQuery({
    queryKey: ["monitor", monitorId],
    queryFn: async () => {
      const response = await fetch(`/api/monitors/${monitorId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch monitor: ${response.status}`);
      }
      const data = await response.json();
      return data.monitor || data;
    },
    staleTime: 30 * 1000, // 30 seconds - match useMonitor hook
  });
}

/**
 * Clear all active prefetch entries
 *
 * Useful for cleanup on sign-out to prevent data leakage.
 */
export function clearPrefetchState(): void {
  activePrefetches.clear();
}

// ============================================================================
// SIDEBAR NAVIGATION PREFETCH
// ============================================================================

const STALE_TIME = 5 * 60 * 1000; // 5 minutes

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

type RouteConfig = {
  queryKey: readonly unknown[];
  queryFn: () => Promise<unknown>;
  staleTime?: number;
};

function getRouteConfigs(projectId: string): Record<string, RouteConfig> {
  return {
    "/": {
      queryKey: ["dashboard", projectId],
      queryFn: () => fetchJson("/api/dashboard"),
      staleTime: 60000,
    },
    "/tests": {
      queryKey: ["tests", projectId, "{}"],
      queryFn: () => fetchJson("/api/tests"),
      staleTime: STALE_TIME,
    },
    "/jobs": {
      queryKey: ["jobs", projectId, "{}"],
      queryFn: () => fetchJson("/api/jobs"),
      staleTime: STALE_TIME,
    },
    "/runs": {
      queryKey: ["runs", projectId, "{}"],
      queryFn: () => fetchJson("/api/runs"),
      staleTime: STALE_TIME,
    },
    "/monitors": {
      queryKey: ["monitors", projectId, "{}"],
      queryFn: () => fetchJson("/api/monitors"),
      staleTime: STALE_TIME,
    },
    "/requirements": {
      queryKey: ["requirements", projectId, "{}"],
      queryFn: () => fetchJson("/api/requirements"),
      staleTime: STALE_TIME,
    },
    "/status-pages": {
      queryKey: ["statusPages", projectId, "{}"],
      queryFn: () => fetchJson("/api/status-pages"),
      staleTime: STALE_TIME,
    },
    "/alerts": {
      queryKey: ["notification-providers", projectId],
      queryFn: () => fetchJson("/api/notification-providers"),
      staleTime: STALE_TIME,
    },
    "/variables": {
      queryKey: ["variables", projectId],
      queryFn: () => fetchJson(`/api/projects/${projectId}/variables`),
      staleTime: STALE_TIME,
    },
  };
}

/**
 * Prefetch data for a sidebar navigation route.
 * Call this on hover to warm the cache before navigation.
 */
export function prefetchSidebarRoute(
  href: string,
  projectId: string | null,
  queryClient: QueryClient
): void {
  if (!projectId) return;

  const key = `sidebar-${href}-${projectId}`;
  if (shouldSkipPrefetch(key)) return;
  markPrefetchActive(key);

  const configs = getRouteConfigs(projectId);
  const config = configs[href];

  if (config) {
    void queryClient.prefetchQuery({
      queryKey: config.queryKey as unknown[],
      queryFn: config.queryFn,
      staleTime: config.staleTime ?? STALE_TIME,
    });
  }

  // Prefetch playground routes trigger Monaco preload
  if (href.startsWith("/playground")) {
    triggerMonacoPreload();
  }
}
