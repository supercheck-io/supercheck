/**
 * React Query hooks for Observability data fetching
 */

"use client";

import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type {
  TraceFilters,
  LogFilters,
  MetricFilters,
  TraceSearchResponse,
  LogSearchResponse,
  MetricQueryResponse,
  TraceWithSpans,
  ServiceMetrics,
  RunObservabilityResponse,
  ContextualMetricsResponse,
  ServiceMapData,
  TimeRange,
} from "~/types/observability";

// ============================================================================
// TRACE HOOKS
// ============================================================================

/**
 * Search traces with filters
 */
export function useTracesQuery(filters: TraceFilters, options?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: ["observability", "traces", "search", filters],
    queryFn: async () => {
      const params = new URLSearchParams();

      if (filters.projectId) params.append("projectId", filters.projectId);
      if (filters.runType) {
        const runTypes = Array.isArray(filters.runType) ? filters.runType : [filters.runType];
        params.append("runType", runTypes.join(","));
      }
      if (filters.runId) params.append("runId", filters.runId);
      if (filters.testId) params.append("testId", filters.testId);
      if (filters.jobId) params.append("jobId", filters.jobId);
      if (filters.monitorId) params.append("monitorId", filters.monitorId);
      if (filters.serviceName) {
        const services = Array.isArray(filters.serviceName) ? filters.serviceName : [filters.serviceName];
        params.append("serviceName", services.join(","));
      }
      if (filters.status) {
        const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
        params.append("status", statuses.join(","));
      }
      if (filters.minDuration) params.append("minDuration", String(filters.minDuration));
      if (filters.maxDuration) params.append("maxDuration", String(filters.maxDuration));
      if (filters.search) params.append("search", filters.search);
      if (filters.limit) params.append("limit", String(filters.limit));
      if (filters.offset) params.append("offset", String(filters.offset));

      params.append("start", filters.timeRange.start);
      params.append("end", filters.timeRange.end);

      const response = await fetch(`/api/observability/traces/search?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Failed to search traces");
      }

      return response.json() as Promise<TraceSearchResponse>;
    },
    enabled: options?.enabled !== false,
    refetchInterval: options?.refetchInterval,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Get a specific trace by ID
 */
export function useTraceQuery(traceId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["observability", "traces", traceId],
    queryFn: async () => {
      if (!traceId) throw new Error("Trace ID is required");

      const response = await fetch(`/api/observability/traces/${traceId}`);

      if (!response.ok) {
        throw new Error("Failed to get trace");
      }

      return response.json() as Promise<TraceWithSpans>;
    },
    enabled: !!traceId && options?.enabled !== false,
    staleTime: 60000, // 1 minute
  });
}

// ============================================================================
// LOG HOOKS
// ============================================================================

/**
 * Search logs with filters
 */
export function useLogsQuery(filters: LogFilters, options?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: ["observability", "logs", "search", filters],
    queryFn: async () => {
      const params = new URLSearchParams();

      if (filters.projectId) params.append("projectId", filters.projectId);
      if (filters.runType) {
        const runTypes = Array.isArray(filters.runType) ? filters.runType : [filters.runType];
        params.append("runType", runTypes.join(","));
      }
      if (filters.runId) params.append("runId", filters.runId);
      if (filters.serviceName) {
        const services = Array.isArray(filters.serviceName) ? filters.serviceName : [filters.serviceName];
        params.append("serviceName", services.join(","));
      }
      if (filters.severityLevel) {
        const levels = Array.isArray(filters.severityLevel) ? filters.severityLevel : [filters.severityLevel];
        params.append("severityLevel", levels.join(","));
      }
      if (filters.traceId) params.append("traceId", filters.traceId);
      if (filters.spanId) params.append("spanId", filters.spanId);
      if (filters.search) params.append("search", filters.search);
      if (filters.limit) params.append("limit", String(filters.limit));
      if (filters.offset) params.append("offset", String(filters.offset));

      params.append("start", filters.timeRange.start);
      params.append("end", filters.timeRange.end);

      const response = await fetch(`/api/observability/logs/search?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Failed to search logs");
      }

      return response.json() as Promise<LogSearchResponse>;
    },
    enabled: options?.enabled !== false,
    refetchInterval: options?.refetchInterval,
    staleTime: 10000, // 10 seconds
  });
}

/**
 * Infinite scroll for logs
 */
export function useInfiniteLogsQuery(filters: Omit<LogFilters, "offset">) {
  return useInfiniteQuery({
    queryKey: ["observability", "logs", "infinite", filters],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams();

      if (filters.projectId) params.append("projectId", filters.projectId);
      if (filters.runType) {
        const runTypes = Array.isArray(filters.runType) ? filters.runType : [filters.runType];
        params.append("runType", runTypes.join(","));
      }
      if (filters.runId) params.append("runId", filters.runId);
      if (filters.serviceName) {
        const services = Array.isArray(filters.serviceName) ? filters.serviceName : [filters.serviceName];
        params.append("serviceName", services.join(","));
      }
      if (filters.severityLevel) {
        const levels = Array.isArray(filters.severityLevel) ? filters.severityLevel : [filters.severityLevel];
        params.append("severityLevel", levels.join(","));
      }
      if (filters.traceId) params.append("traceId", filters.traceId);
      if (filters.spanId) params.append("spanId", filters.spanId);
      if (filters.search) params.append("search", filters.search);
      if (filters.limit) params.append("limit", String(filters.limit));

      params.append("offset", String(pageParam));
      params.append("start", filters.timeRange.start);
      params.append("end", filters.timeRange.end);

      const response = await fetch(`/api/observability/logs/search?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Failed to search logs");
      }

      return response.json() as Promise<LogSearchResponse>;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) return undefined;
      return lastPage.offset + lastPage.limit;
    },
    staleTime: 10000,
  });
}

// ============================================================================
// METRIC HOOKS
// ============================================================================

/**
 * Query metrics time series
 */
export function useMetricsQuery(filters: MetricFilters, options?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: ["observability", "metrics", "timeseries", filters],
    queryFn: async () => {
      const params = new URLSearchParams();

      if (filters.projectId) params.append("projectId", filters.projectId);
      if (filters.runType) {
        const runTypes = Array.isArray(filters.runType) ? filters.runType : [filters.runType];
        params.append("runType", runTypes.join(","));
      }
      if (filters.serviceName) {
        const services = Array.isArray(filters.serviceName) ? filters.serviceName : [filters.serviceName];
        params.append("serviceName", services.join(","));
      }
      if (filters.metricName) {
        const metrics = Array.isArray(filters.metricName) ? filters.metricName : [filters.metricName];
        params.append("metricName", metrics.join(","));
      }
      if (filters.groupBy) params.append("groupBy", filters.groupBy.join(","));
      if (filters.aggregation) params.append("aggregation", filters.aggregation);
      if (filters.interval) params.append("interval", filters.interval);

      params.append("start", filters.timeRange.start);
      params.append("end", filters.timeRange.end);

      const response = await fetch(`/api/observability/metrics/timeseries?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Failed to query metrics");
      }

      return response.json() as Promise<MetricQueryResponse>;
    },
    enabled: options?.enabled !== false,
    refetchInterval: options?.refetchInterval,
    staleTime: 15000, // 15 seconds
  });
}

/**
 * Get service metrics
 */
export function useServiceMetricsQuery(
  serviceName: string | null,
  timeRange: { start: string; end: string },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ["observability", "services", serviceName, "metrics", timeRange],
    queryFn: async () => {
      if (!serviceName) throw new Error("Service name is required");

      const params = new URLSearchParams();
      params.append("start", timeRange.start);
      params.append("end", timeRange.end);

      const response = await fetch(`/api/observability/services/${serviceName}/metrics?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Failed to get service metrics");
      }

      return response.json() as Promise<ServiceMetrics>;
    },
    enabled: !!serviceName && options?.enabled !== false,
    staleTime: 30000,
  });
}

// ============================================================================
// CONTEXTUAL ENTITY HOOKS
// ============================================================================

type ContextualEntity = "tests" | "jobs" | "monitors";

export function useRunObservability(
  runId: string | null,
  options?: { enabled?: boolean; start?: string; end?: string }
) {
  return useQuery({
    queryKey: ["observability", "run", runId, options?.start, options?.end],
    queryFn: async () => {
      if (!runId) throw new Error("Run ID is required");
      const params = new URLSearchParams();
      if (options?.start) params.append("start", options.start);
      if (options?.end) params.append("end", options.end);
      const response = await fetch(
        `/api/observability/runs/${runId}?${params.toString()}`
      );
      if (!response.ok) {
        throw new Error("Failed to load run observability data");
      }
      return (await response.json()) as RunObservabilityResponse;
    },
    enabled: !!runId && options?.enabled !== false,
    staleTime: 30000,
  });
}

export function useContextualMetrics(
  entity: ContextualEntity,
  entityId: string | null,
  options?: {
    enabled?: boolean;
    start?: string;
    end?: string;
    buckets?: number;
    refetchInterval?: number;
  }
) {
  return useQuery({
    queryKey: [
      "observability",
      entity,
      entityId,
      options?.start,
      options?.end,
      options?.buckets,
    ],
    queryFn: async () => {
      if (!entityId) throw new Error("Entity ID is required");
      const params = new URLSearchParams();
      if (options?.start) params.append("start", options.start);
      if (options?.end) params.append("end", options.end);
      if (options?.buckets) params.append("buckets", options.buckets.toString());
      const response = await fetch(
        `/api/observability/${entity}/${entityId}/metrics?${params.toString()}`
      );
      if (!response.ok) {
        throw new Error("Failed to load metrics");
      }
      return (await response.json()) as ContextualMetricsResponse;
    },
    enabled: !!entityId && options?.enabled !== false,
    staleTime: 60000,
    refetchInterval: options?.refetchInterval,
  });
}

/**
 * Get service map data
 */
export function useServiceMap(timeRange: TimeRange, options?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: ["observability", "service-map", timeRange],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("start", timeRange.start);
      params.append("end", timeRange.end);

      const response = await fetch(`/api/observability/service-map?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Failed to fetch service map");
      }

      return response.json() as Promise<ServiceMapData>;
    },
    enabled: options?.enabled !== false,
    refetchInterval: options?.refetchInterval,
    staleTime: 60000, // 1 minute
  });
}

// ============================================================================
// UTILITY HOOKS
// ============================================================================

/**
 * Prefetch trace data
 */
export function usePrefetchTrace() {
  const queryClient = useQueryClient();

  return (traceId: string) => {
    queryClient.prefetchQuery({
      queryKey: ["observability", "traces", traceId],
      queryFn: async () => {
        const response = await fetch(`/api/observability/traces/${traceId}`);
        if (!response.ok) throw new Error("Failed to prefetch trace");
        return response.json();
      },
    });
  };
}

/**
 * Invalidate observability queries
 */
export function useInvalidateObservability() {
  const queryClient = useQueryClient();

  return {
    invalidateTraces: () =>
      queryClient.invalidateQueries({ queryKey: ["observability", "traces"] }),
    invalidateLogs: () =>
      queryClient.invalidateQueries({ queryKey: ["observability", "logs"] }),
    invalidateMetrics: () =>
      queryClient.invalidateQueries({ queryKey: ["observability", "metrics"] }),
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: ["observability"] }),
  };
}

/**
 * Custom hook for live-updating traces (auto-refresh)
 */
export function useLiveTraces(filters: TraceFilters, refreshInterval = 5000) {
  return useTracesQuery(filters, { refetchInterval: refreshInterval });
}

/**
 * Custom hook for live-updating logs
 */
export function useLiveLogs(filters: LogFilters, refreshInterval = 3000) {
  return useLogsQuery(filters, { refetchInterval: refreshInterval });
}

/**
 * Custom hook for live-updating metrics
 */
export function useLiveMetrics(filters: MetricFilters, refreshInterval = 10000) {
  return useMetricsQuery(filters, { refetchInterval: refreshInterval });
}
