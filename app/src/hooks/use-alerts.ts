import { useQuery, useQueryClient, useMutation, useIsRestoring, keepPreviousData } from "@tanstack/react-query";
import { useProjectContext } from "./use-project-context";
import type {
  NotificationProviderType,
  NotificationProviderConfig,
} from "@/db/schema";
import type { AlertHistory as AlertHistorySchema } from "@/components/alerts/schema";

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

export type AlertHistory = AlertHistorySchema;

export const NOTIFICATION_PROVIDERS_QUERY_KEY = ["notification-providers"] as const;
export const ALERTS_HISTORY_QUERY_KEY = ["alerts-history"] as const;

export function getNotificationProvidersQueryKey(projectId: string | null) {
  return [...NOTIFICATION_PROVIDERS_QUERY_KEY, projectId] as const;
}

export function getAlertsHistoryQueryKey(projectId: string | null) {
  return [...ALERTS_HISTORY_QUERY_KEY, projectId] as const;
}

export async function fetchNotificationProviders(projectId?: string | null): Promise<NotificationProvider[]> {
  const headers: Record<string, string> = {};
  if (projectId) {
    headers["x-project-id"] = projectId;
  }
  
  const response = await fetch("/api/notification-providers", {
    headers
  });

  if (!response.ok) {
    throw new Error("Failed to fetch notification providers");
  }
  return response.json();
}

export async function fetchAlertHistory(projectId?: string | null): Promise<AlertHistory[]> {
  const headers: Record<string, string> = {};
  if (projectId) {
    headers["x-project-id"] = projectId;
  }

  const response = await fetch("/api/alerts/history", {
    headers
  });

  if (!response.ok) {
    throw new Error("Failed to fetch alert history");
  }
  return response.json();
}

export function useNotificationProviders() {
  const { currentProject, loading: isProjectLoading } = useProjectContext();
  const projectId = currentProject?.id ?? null;
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();

  const queryKey = [...NOTIFICATION_PROVIDERS_QUERY_KEY, projectId];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchNotificationProviders(projectId),
    enabled: !!projectId,
    staleTime: 30 * 1000,  // 30 seconds - alerts need to be responsive
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',  // Always refetch on page visit for fresh data
    refetchOnReconnect: false,
    // Note: Removed placeholderData to ensure fresh data is shown immediately after fetch
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ 
      queryKey: NOTIFICATION_PROVIDERS_QUERY_KEY, 
      refetchType: 'all' 
    });

  // Loading if:
  // 1. Project context is still loading
  // 2. Project ID is not yet available (unless context loaded and gave us null, but here we assume we wait for a valid project)
  // 3. The query itself is loading (initial fetch)
  const isInitialLoading = isProjectLoading || (!projectId && isProjectLoading) || (query.isPending && query.isFetching && !isRestoring);

  return {
    providers: query.data ?? [],
    isLoading: isInitialLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
    invalidate,
  };
}

export function useAlertHistory() {
  const { currentProject, loading: isProjectLoading } = useProjectContext();
  const projectId = currentProject?.id ?? null;
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();

  const queryKey = [...ALERTS_HISTORY_QUERY_KEY, projectId];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchAlertHistory(projectId),
    enabled: !!projectId,
    staleTime: 30 * 1000,  // 30 seconds - alert history should be responsive
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',  // Always refetch on page visit for fresh data
    refetchOnReconnect: false,
    // Note: Removed placeholderData to ensure fresh data is shown immediately after fetch
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ 
      queryKey: ALERTS_HISTORY_QUERY_KEY, 
      refetchType: 'all' 
    });

  // Ensure we show loading state while waiting for project context
  const isInitialLoading = isProjectLoading || (!projectId && isProjectLoading) || (query.isPending && query.isFetching && !isRestoring);

  return {
    alertHistory: query.data ?? [],
    isLoading: isInitialLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
    invalidate,
  };
}

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
