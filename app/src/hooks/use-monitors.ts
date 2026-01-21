import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createDataHook, type PaginatedResponse } from "./lib/create-data-hook";
import { DASHBOARD_QUERY_KEY } from "./use-dashboard";

export interface MonitorAlertConfig {
  enabled: boolean;
  notificationProviders?: string[];
  alertOnFailure?: boolean;
  alertOnRecovery?: boolean;
  alertOnSslExpiration?: boolean;
  alertOnSuccess?: boolean;
  alertOnTimeout?: boolean;
  failureThreshold?: number;
  recoveryThreshold?: number;
  customMessage?: string;
}

export interface Monitor {
  id: string;
  name: string;
  description?: string | null;
  type: "http_request" | "website" | "ping_host" | "port_check" | "synthetic_test";
  target: string;
  frequencyMinutes: number;
  enabled: boolean;
  status: "up" | "down" | "paused" | "pending" | "maintenance" | "error";
  config?: Record<string, unknown>;
  alertConfig?: MonitorAlertConfig | null;
  lastCheckAt?: string | null;
  lastStatusChangeAt?: string | null;
  mutedUntil?: string | null;
  createdAt?: string;
  updatedAt?: string;
  projectId?: string;
  organizationId?: string | null;
  createdByUserId?: string | null;
  projectName?: string;
  // Legacy fields for backward compatibility
  url?: string;
  timeout?: number;
  expectedStatus?: number;
  expectedResponseBody?: string;
  port?: number;
  lastCheckedAt?: string;
  responseTime?: number;
  uptime?: string | number;
  active?: boolean;
  tags?: Array<{ id: string; name: string; color: string }>;
}

export interface MonitorsResponse extends PaginatedResponse<Monitor> {}

interface CreateMonitorData {
  name: string;
  type: string;
  url?: string;
  interval?: number;
  config?: Record<string, unknown>;
}

interface UpdateMonitorData {
  id: string;
  name?: string;
  url?: string;
  interval?: number;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export const MONITORS_QUERY_KEY = ["monitors"] as const;
export const MONITOR_QUERY_KEY = ["monitor"] as const;

export function getMonitorsListQueryKey(projectId: string | null) {
  return [...MONITORS_QUERY_KEY, projectId, "{}"] as const;
}

const monitorsHook = createDataHook<Monitor, CreateMonitorData, UpdateMonitorData>({
  queryKey: MONITORS_QUERY_KEY,
  endpoint: "/api/monitors",
  staleTime: 30 * 1000,
  refetchOnWindowFocus: false,
  refetchOnMount: 'always',  // Always refetch on page visit - monitor status changes server-side
  singleItemField: "monitor",
});

export interface UseMonitorsOptions {
  page?: number;
  pageSize?: number;
  status?: string;
  type?: string;
  enabled?: boolean;
  queryEnabled?: boolean;
}

export function useMonitors(options: UseMonitorsOptions = {}) {
  const { queryEnabled = true, ...filters } = options;
  const listOptions = { ...filters, enabled: queryEnabled } as UseMonitorsOptions & { [key: string]: unknown };
  const result = monitorsHook.useList(listOptions);

  return {
    ...result,
    monitors: result.items,
  };
}

export function useMonitor(monitorId: string | null) {
  return monitorsHook.useSingle(monitorId);
}

export function useMonitorMutations() {
  const queryClient = useQueryClient();
  const baseMutations = monitorsHook.useMutations();

  // Custom toggle mutation for enabling/disabling monitors
  const toggleMonitor = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const response = await fetch(`/api/monitors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to toggle monitor");
      }
      return response.json();
    },
    // Optimistic update for toggle
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: MONITORS_QUERY_KEY });
      await queryClient.cancelQueries({ queryKey: [...MONITOR_QUERY_KEY, id] });

      const previousList = queryClient.getQueriesData({ queryKey: MONITORS_QUERY_KEY });
      const previousSingle = queryClient.getQueryData([...MONITOR_QUERY_KEY, id]);

      // Optimistically update list
      queryClient.setQueriesData<MonitorsResponse>(
        { queryKey: MONITORS_QUERY_KEY },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map((monitor) =>
              monitor.id === id ? { ...monitor, enabled } : monitor
            ),
          };
        }
      );

      // Optimistically update single
      queryClient.setQueryData<Monitor>([...MONITOR_QUERY_KEY, id], (old) => {
        if (!old) return old;
        return { ...old, enabled };
      });

      return { previousList, previousSingle, id };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousList) {
        (context.previousList as [readonly unknown[], unknown][]).forEach(([key, value]) => {
          queryClient.setQueryData(key, value);
        });
      }
      if (context?.previousSingle && context?.id) {
        queryClient.setQueryData([...MONITOR_QUERY_KEY, context.id], context.previousSingle);
      }
    },
    onSettled: (_data, _err, variables) => {
      queryClient.invalidateQueries({ queryKey: MONITORS_QUERY_KEY, refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: [...MONITOR_QUERY_KEY, variables.id], refetchType: 'all' });
      // Cross-entity: Dashboard shows Active Monitors count
      queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY, refetchType: 'all' });
    },
  });

  // Wrap base mutations to also invalidate dashboard (cross-entity invalidation)
  const createMonitor = {
    ...baseMutations.create,
    mutateAsync: async (...args: Parameters<typeof baseMutations.create.mutateAsync>) => {
      const result = await baseMutations.create.mutateAsync(...args);
      queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY, refetchType: 'all' });
      return result;
    },
  };

  const deleteMonitor = {
    ...baseMutations.remove,
    mutateAsync: async (...args: Parameters<typeof baseMutations.remove.mutateAsync>) => {
      const result = await baseMutations.remove.mutateAsync(...args);
      queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY, refetchType: 'all' });
      return result;
    },
  };

  return {
    createMonitor,
    updateMonitor: baseMutations.update,
    deleteMonitor,
    toggleMonitor,
  };
}
