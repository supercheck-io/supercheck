"use client";

import { useEffect, useState, useRef, useCallback } from "react";

// Default capacity limits used only as initial state before API response
// Actual limits come from API which handles:
// - Self-hosted mode: Uses RUNNING_CAPACITY/QUEUED_CAPACITY env vars
// - Cloud mode: Uses plan-specific limits from database (plus/pro plans)
const DEFAULT_RUNNING_CAPACITY = 1;
const DEFAULT_QUEUED_CAPACITY = 10;

// Custom event name for execution changes
const EXECUTIONS_CHANGED_EVENT = "supercheck:executions-changed";

/**
 * Trigger an instant refresh of the executions data.
 * Call this after submitting a job to ensure the UI updates immediately.
 * 
 * This is a browser-side event that the useExecutions hook listens to,
 * providing instant updates without waiting for SSE events.
 * 
 * @example
 * // In your job submission handler:
 * const response = await fetch('/api/jobs/run', { method: 'POST', ... });
 * if (response.ok) {
 *   notifyExecutionsChanged();
 * }
 */
export function notifyExecutionsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EXECUTIONS_CHANGED_EVENT));
  }
}

// Execution item interface matching /api/executions/running response
export interface ExecutionItem {
  runId: string;
  jobId: string | null;
  jobName: string;
  jobType: "playwright" | "k6";
  status: "running" | "queued";
  startedAt: Date | null;
  queuePosition?: number;
  source?: "job" | "playground";
  projectName?: string;
}

// Hook return type
export interface UseExecutionsReturn {
  running: ExecutionItem[];
  queued: ExecutionItem[];
  runningCount: number;
  queuedCount: number;
  runningCapacity: number;
  queuedCapacity: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

// ============================================================================
// MODULE-LEVEL CACHE (prevents refetch on every component mount)
// ============================================================================
interface ExecutionsCache {
  running: ExecutionItem[];
  queued: ExecutionItem[];
  runningCapacity: number;
  queuedCapacity: number;
  timestamp: number;
}

let executionsCache: ExecutionsCache | null = null;
const CACHE_TTL = 5000; // 5 seconds - balance between freshness and performance

// Promise-based lock to prevent race conditions when multiple components
// call getExecutionsData simultaneously while cache is stale
let pendingFetch: Promise<{
  running: ExecutionItem[];
  queued: ExecutionItem[];
  runningCapacity: number;
  queuedCapacity: number;
} | null> | null = null;

/**
 * Get cached executions data or fetch fresh if cache is stale.
 * PERFORMANCE: Shared function to prevent duplicate /api/executions/running calls
 * from multiple components (useExecutions hook, job-context.tsx, etc.)
 * 
 * Uses promise-based locking to ensure only one fetch happens at a time
 * when the cache is stale - other callers wait for the same promise.
 * 
 * @returns Cached or freshly fetched executions data
 */
export async function getExecutionsData(): Promise<{
  running: ExecutionItem[];
  queued: ExecutionItem[];
  runningCapacity: number;
  queuedCapacity: number;
} | null> {
  const now = Date.now();
  
  // Return cached data if available and not expired
  if (executionsCache && (now - executionsCache.timestamp) < CACHE_TTL) {
    return {
      running: executionsCache.running,
      queued: executionsCache.queued,
      runningCapacity: executionsCache.runningCapacity,
      queuedCapacity: executionsCache.queuedCapacity,
    };
  }

  // If a fetch is already in progress, wait for it instead of starting another
  if (pendingFetch) {
    return pendingFetch;
  }

  // Start a new fetch and store the promise
  pendingFetch = (async () => {
    try {
      const res = await fetch("/api/executions/running", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });

      if (!res.ok) {
        console.error("Failed to fetch executions");
        return null;
      }

      const data = await res.json();
      
      const running: ExecutionItem[] = (data.running || []).map((item: ExecutionItem) => ({
        ...item,
        startedAt: item.startedAt ? new Date(item.startedAt) : null,
      }));
      const queued: ExecutionItem[] = (data.queued || []).map((item: ExecutionItem) => ({
        ...item,
        startedAt: item.startedAt ? new Date(item.startedAt) : null,
      }));
      const runningCapacity = typeof data.runningCapacity === 'number' ? data.runningCapacity : 1;
      const queuedCapacity = typeof data.queuedCapacity === 'number' ? data.queuedCapacity : 10;

      // Update cache
      executionsCache = {
        running,
        queued,
        runningCapacity,
        queuedCapacity,
        timestamp: Date.now(),
      };

      return { running, queued, runningCapacity, queuedCapacity };
    } catch (error) {
      console.error("Error fetching executions:", error);
      return null;
    } finally {
      // Clear the pending fetch so next call can start a new one
      pendingFetch = null;
    }
  })();

  return pendingFetch;
}


// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

/**
 * Shared hook for fetching executions data
 * Uses multiple mechanisms for real-time updates:
 * 
 * 1. SSE (/api/executions/events) - For BullMQ job lifecycle events
 * 2. Browser events (notifyExecutionsChanged) - For instant updates on job submission
 * 3. Visibility change - Refresh when tab becomes visible
 * 
 * PERFORMANCE OPTIMIZATION: Uses module-level cache to prevent
 * duplicate API calls when navigating between pages.
 * 
 * SINGLE SOURCE OF TRUTH: Both the top bar and dialog use this hook
 * to ensure consistent data across the UI.
 * 
 * CAPACITY LIMITS: Fetched from API which handles:
 * - Self-hosted mode (SELF_HOSTED=true): Uses RUNNING_CAPACITY/QUEUED_CAPACITY env vars
 * - Cloud mode: Uses plan-specific limits from database (plus/pro plans)
 */
export function useExecutions(): UseExecutionsReturn {
  const [running, setRunning] = useState<ExecutionItem[]>(executionsCache?.running || []);
  const [queued, setQueued] = useState<ExecutionItem[]>(executionsCache?.queued || []);
  const [runningCapacity, setRunningCapacity] = useState(executionsCache?.runningCapacity || DEFAULT_RUNNING_CAPACITY);
  const [queuedCapacity, setQueuedCapacity] = useState(executionsCache?.queuedCapacity || DEFAULT_QUEUED_CAPACITY);
  const [loading, setLoading] = useState(!executionsCache);
  
  // Refs for SSE connection management
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);
  // Debounce ref to prevent rapid refetches
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch executions using the shared getExecutionsData function
  // This ensures consistent caching behavior across the app
  const fetchExecutions = useCallback(async (forceRefresh = false) => {
    if (!mountedRef.current) return;

    // For force refresh, invalidate cache by setting timestamp to 0
    if (forceRefresh && executionsCache) {
      executionsCache.timestamp = 0;
    }

    try {
      const data = await getExecutionsData();
      
      if (!mountedRef.current) return;
      
      if (data) {
        setRunning(data.running);
        setQueued(data.queued);
        setRunningCapacity(data.runningCapacity);
        setQueuedCapacity(data.queuedCapacity);
      }
      setLoading(false);
    } catch (error) {
      console.error("Error fetching executions:", error);
      setLoading(false);
    }
  }, []);

  // Debounced refresh to batch rapid updates (300ms debounce)
  // Forces refresh to bypass cache when triggered by SSE or manual action
  const debouncedRefresh = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      fetchExecutions(true); // Force refresh - bypass cache
    }, 300);
  }, [fetchExecutions]);

  // Set up SSE connection for real-time updates
  const setupEventSource = useCallback(function setupEventSourceInner() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const source = new EventSource("/api/executions/events");
      eventSourceRef.current = source;

      source.onopen = () => {
        reconnectAttemptsRef.current = 0;
      };

      source.onmessage = () => {
        // SSE Strategy: Any job event triggers a refresh to get accurate counts
        // This handles promotions (queued -> running) and completions
        debouncedRefresh();
      };

      source.onerror = () => {
        source.close();
        eventSourceRef.current = null;

        // Exponential backoff for reconnection
        const backoffTime = Math.min(
          1000 * Math.pow(1.5, reconnectAttemptsRef.current),
          10000
        );
        reconnectAttemptsRef.current++;

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        reconnectTimeoutRef.current = setTimeout(() => {
          if (document.visibilityState !== "hidden" && mountedRef.current) {
            setupEventSourceInner();
          }
        }, backoffTime);
      };

      return source;
    } catch (err) {
      console.error("Failed to initialize SSE:", err);
      return null;
    }
  }, [debouncedRefresh]);

  // Initialize on mount
  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch
    fetchExecutions();

    // Set up SSE connection for real-time updates
    setupEventSource();

    // Handle visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchExecutions();
        // Reconnect SSE if not connected
        if (!eventSourceRef.current) {
          setupEventSource();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Listen for custom execution change events (from job submission)
    // This provides INSTANT updates when jobs are submitted
    const handleExecutionsChanged = () => {
      debouncedRefresh();
    };
    window.addEventListener(EXECUTIONS_CHANGED_EVENT, handleExecutionsChanged);

    // Cleanup
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(EXECUTIONS_CHANGED_EVENT, handleExecutionsChanged);

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [fetchExecutions, setupEventSource, debouncedRefresh]);

  return {
    running,
    queued,
    runningCount: running.length,
    queuedCount: queued.length,
    runningCapacity,
    queuedCapacity,
    loading,
    refresh: fetchExecutions,
  };
}
