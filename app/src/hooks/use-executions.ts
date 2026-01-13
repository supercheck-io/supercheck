"use client";

import { useEffect, useState, useRef, useCallback } from "react";

const DEFAULT_RUNNING_CAPACITY = 1;
const DEFAULT_QUEUED_CAPACITY = 10;

const EXECUTIONS_CHANGED_EVENT = "supercheck:executions-changed";

export function notifyExecutionsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EXECUTIONS_CHANGED_EVENT));
  }
}

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

interface ExecutionsCache {
  running: ExecutionItem[];
  queued: ExecutionItem[];
  runningCapacity: number;
  queuedCapacity: number;
  timestamp: number;
}

let executionsCache: ExecutionsCache | null = null;
const CACHE_TTL = 5000;

let pendingFetch: Promise<{
  running: ExecutionItem[];
  queued: ExecutionItem[];
  runningCapacity: number;
  queuedCapacity: number;
} | null> | null = null;

export async function getExecutionsData(): Promise<{
  running: ExecutionItem[];
  queued: ExecutionItem[];
  runningCapacity: number;
  queuedCapacity: number;
} | null> {
  const now = Date.now();
  
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
      pendingFetch = null;
    }
  })();

  return pendingFetch;
}

export function useExecutions(): UseExecutionsReturn {
  const [running, setRunning] = useState<ExecutionItem[]>(executionsCache?.running || []);
  const [queued, setQueued] = useState<ExecutionItem[]>(executionsCache?.queued || []);
  const [runningCapacity, setRunningCapacity] = useState(executionsCache?.runningCapacity || DEFAULT_RUNNING_CAPACITY);
  const [queuedCapacity, setQueuedCapacity] = useState(executionsCache?.queuedCapacity || DEFAULT_QUEUED_CAPACITY);
  const [loading, setLoading] = useState(!executionsCache);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const fetchExecutions = useCallback(async (forceRefresh = false) => {
    if (!mountedRef.current) return;

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

  const debouncedRefresh = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      fetchExecutions(true);
    }, 300);
  }, [fetchExecutions]);

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
        debouncedRefresh();
      };

      source.onerror = () => {
        source.close();
        eventSourceRef.current = null;

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

  useEffect(() => {
    mountedRef.current = true;

    fetchExecutions();

    setupEventSource();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchExecutions();
        if (!eventSourceRef.current) {
          setupEventSource();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const handleExecutionsChanged = () => {
      debouncedRefresh();
    };
    window.addEventListener(EXECUTIONS_CHANGED_EVENT, handleExecutionsChanged);

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
