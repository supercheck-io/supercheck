/**
 * Alerts Data Hook
 *
 * React Query hooks for fetching notification providers and alert history.
 * Uses React Query for caching and prefetch compatibility.
 */

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useProjectContext } from "./use-project-context";
import type {
  NotificationProviderType,
  NotificationProviderConfig,
} from "@/db/schema";
import type { AlertHistory as AlertHistorySchema } from "@/components/alerts/schema";

// ============================================================================
// TYPES
// ============================================================================

export interface NotificationProvider {
  id: string;
  name: string;
  type: NotificationProviderType;
  config: NotificationProviderConfig;
  isEnabled: boolean;
  createdAt: string;
  updatedAt?: string;
  lastUsed?: string;
  isInUse?: boolean;
  maskedFields?: string[];
}

// Re-export AlertHistory type from schema for consistency
export type AlertHistory = AlertHistorySchema;

// ============================================================================
// QUERY KEYS (exported for prefetching)
// ============================================================================

export const NOTIFICATION_PROVIDERS_QUERY_KEY = ["notification-providers"] as const;
export const ALERTS_HISTORY_QUERY_KEY = ["alerts-history"] as const;

// ============================================================================
// FETCH FUNCTIONS (exported for prefetching)
// ============================================================================

export async function fetchNotificationProviders(): Promise<NotificationProvider[]> {
  const response = await fetch("/api/notification-providers");
  if (!response.ok) {
    throw new Error("Failed to fetch notification providers");
  }
  return response.json();
}

export async function fetchAlertHistory(): Promise<AlertHistory[]> {
  const response = await fetch("/api/alerts/history");
  if (!response.ok) {
    throw new Error("Failed to fetch alert history");
  }
  return response.json();
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook to fetch notification providers with React Query caching.
 * Data is cached for 60 seconds and shared across components.
 */
export function useNotificationProviders() {
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [...NOTIFICATION_PROVIDERS_QUERY_KEY, projectId],
    queryFn: fetchNotificationProviders,
    enabled: !!projectId,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ 
      queryKey: NOTIFICATION_PROVIDERS_QUERY_KEY, 
      refetchType: 'all' 
    });

  return {
    providers: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
    invalidate,
  };
}

/**
 * Hook to fetch alert history with React Query caching.
 * Data is cached for 60 seconds.
 */
export function useAlertHistory() {
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [...ALERTS_HISTORY_QUERY_KEY, projectId],
    queryFn: fetchAlertHistory,
    enabled: !!projectId,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ 
      queryKey: ALERTS_HISTORY_QUERY_KEY, 
      refetchType: 'all' 
    });

  return {
    alertHistory: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
    invalidate,
  };
}

/**
 * Hook for notification provider mutations (create, update, delete).
 */
export function useNotificationProviderMutations() {
  const queryClient = useQueryClient();

  const createProvider = useMutation({
    mutationFn: async (data: { type: string; config: Record<string, unknown> }) => {
      const response = await fetch("/api/notification-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: (data.config as Record<string, unknown>)?.name || `New ${data.type} Channel`,
          type: data.type,
          config: data.config,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create notification channel");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_PROVIDERS_QUERY_KEY, refetchType: 'all' });
    },
  });

  const updateProvider = useMutation({
    mutationFn: async (data: { id: string; type: string; config: Record<string, unknown> }) => {
      const response = await fetch(`/api/notification-providers/${data.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: (data.config as Record<string, unknown>)?.name,
          type: data.type,
          config: data.config,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update notification channel");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_PROVIDERS_QUERY_KEY, refetchType: 'all' });
    },
  });

  const deleteProvider = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/notification-providers/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete notification channel");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_PROVIDERS_QUERY_KEY, refetchType: 'all' });
    },
  });

  return {
    createProvider,
    updateProvider,
    deleteProvider,
  };
}
