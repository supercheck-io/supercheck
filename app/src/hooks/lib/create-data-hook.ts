import {
  useQuery,
  useQueryClient,
  useMutation,
  QueryClient,
  useIsRestoring,
  keepPreviousData,
} from "@tanstack/react-query";
import { useProjectContext } from "../use-project-context";

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage?: boolean;
    hasPrevPage?: boolean;
  };
}

export interface DataHookConfig<T, CreateData, UpdateData> {
  queryKey: readonly string[];
  endpoint: string;
  staleTime?: number;
  gcTime?: number;
  refetchOnWindowFocus?: boolean;
  refetchOnMount?: boolean | 'always';
  generateOptimisticItem?: (data: CreateData) => Partial<T>;
  singleItemField?: string;
}

export interface ListQueryOptions {
  page?: number;
  pageSize?: number;
  enabled?: boolean;
}

export interface SingleQueryOptions {
  enabled?: boolean;
}

function buildSearchParams(options: Record<string, unknown>, pageParamName = "limit"): URLSearchParams {
  const params = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (key === "enabled") return;
    if (key === "pageSize") {
      params.set(pageParamName, String(value));
    } else {
      params.set(key, String(value));
    }
  });
  return params;
}

async function fetchList<T>(endpoint: string, options: Record<string, unknown>, projectId?: string | null): Promise<PaginatedResponse<T>> {
  const params = buildSearchParams(options);
  const url = params.toString() ? `${endpoint}?${params}` : endpoint;
  
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (projectId) {
    headers["x-project-id"] = projectId;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

async function fetchSingle<T>(endpoint: string, id: string, singleItemField?: string, projectId?: string | null): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (projectId) {
    headers["x-project-id"] = projectId;
  }

  const response = await fetch(`${endpoint}/${id}`, { headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (singleItemField && data[singleItemField]) {
    return data[singleItemField];
  }
  return data;
}

function createDeleteOptimisticHandlers<T extends { id: string }>(queryClient: QueryClient, queryKey: readonly string[]) {
  return {
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueriesData({ queryKey });
      queryClient.setQueriesData<PaginatedResponse<T>>({ queryKey }, (old) => {
        if (!old) return old;
        return {
          ...old,
          data: old.data.filter((item) => item.id !== id),
          pagination: { ...old.pagination, total: Math.max(0, old.pagination.total - 1) },
        };
      });
      return { previous };
    },
    onError: (_err: unknown, _id: string, context: { previous?: unknown } | undefined) => {
      if (context?.previous) {
        (context.previous as [readonly unknown[], unknown][]).forEach(([key, value]) => {
          queryClient.setQueryData(key, value);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey, refetchType: 'all' });
    },
  };
}

function createUpdateOptimisticHandlers<T extends { id: string }>(
  queryClient: QueryClient,
  queryKey: readonly string[],
  singleQueryKey: readonly string[]
) {
  return {
    onMutate: async (data: { id: string; [key: string]: unknown }) => {
      const { id, ...updates } = data;
      await queryClient.cancelQueries({ queryKey });
      await queryClient.cancelQueries({ queryKey: [...singleQueryKey, id] });
      const previousList = queryClient.getQueriesData({ queryKey });
      const previousSingle = queryClient.getQueryData([...singleQueryKey, id]);
      queryClient.setQueriesData<PaginatedResponse<T>>({ queryKey }, (old) => {
        if (!old) return old;
        return { ...old, data: old.data.map((item) => item.id === id ? { ...item, ...updates } : item) };
      });
      queryClient.setQueryData<T>([...singleQueryKey, id], (old) => old ? { ...old, ...updates } : old);
      return { previousList, previousSingle, id };
    },
    onError: (
      _err: unknown,
      _data: { id: string; [key: string]: unknown },
      context: { previousList?: unknown; previousSingle?: unknown; id?: string } | undefined
    ) => {
      if (context?.previousList) {
        (context.previousList as [readonly unknown[], unknown][]).forEach(([key, value]) => {
          queryClient.setQueryData(key, value);
        });
      }
      if (context?.previousSingle && context?.id) {
        queryClient.setQueryData([...singleQueryKey, context.id], context.previousSingle);
      }
    },
    onSettled: (_data: unknown, _err: unknown, variables: { id: string }) => {
      queryClient.invalidateQueries({ queryKey, refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: [...singleQueryKey, variables.id], refetchType: 'all' });
    },
  };
}

export function createDataHook<
  T extends { id: string },
  CreateData = Partial<T>,
  UpdateData extends { id: string } = { id: string } & Partial<T>
>(config: DataHookConfig<T, CreateData, UpdateData>) {
  const {
    queryKey,
    endpoint,
    staleTime,  // Use global default from QueryClient if not specified
    gcTime,     // Use global default from QueryClient if not specified
    refetchOnWindowFocus = false,
    refetchOnMount = false,
    singleItemField,
  } = config;

  const singleQueryKey = [queryKey[0].replace(/s$/, "")] as const;

  const getListQueryKey = (projectId: string | null, filters?: Record<string, unknown>) => {
    const cleanFilters = filters
      ? Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined))
      : {};
    const filtersKey = JSON.stringify(cleanFilters);
    return [...queryKey, projectId, filtersKey] as const;
  };

  function useList(options: ListQueryOptions & { [key: string]: unknown } = {}) {
    const { currentProject } = useProjectContext();
    const projectId = currentProject?.id ?? null;
    const queryClient = useQueryClient();
    const isRestoring = useIsRestoring();
    const { enabled = true, ...filters } = options;
    const fullQueryKey = getListQueryKey(projectId, filters);

    const query = useQuery({
      queryKey: fullQueryKey,
      queryFn: () => fetchList<T>(endpoint, filters, projectId),
      enabled: enabled && !!projectId,
      // Only override if explicitly specified, otherwise use global defaults
      ...(staleTime !== undefined && { staleTime }),
      ...(gcTime !== undefined && { gcTime }),
      refetchOnWindowFocus,
      refetchOnMount,
      refetchOnReconnect: false,
      // Note: Removed placeholderData to ensure fresh data is shown immediately after fetch
    });

    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey, refetchType: 'all' });

    // Simple loading state: only true when no data AND actively fetching
    // React Query handles cache lookup automatically - if data exists, query.data is set
    const hasData = query.data !== undefined;
    const isInitialLoading = query.isPending && query.isFetching && !isRestoring;

    return {
      data: query.data,
      items: query.data?.data ?? [],
      total: query.data?.pagination?.total ?? 0,
      pagination: query.data?.pagination,
      isLoading: isInitialLoading,
      isPending: query.isPending,
      isRestoring,
      isRefetching: query.isRefetching,
      isFetching: query.isFetching,
      hasData,
      error: query.error as Error | null,
      refetch: query.refetch,
      invalidate,
    };
  }

  function useSingle(id: string | null, options: SingleQueryOptions = {}) {
    const queryClient = useQueryClient();
    const isRestoring = useIsRestoring();
    const { enabled = true } = options;
    const singleKey = [...singleQueryKey, id];

    const { currentProject } = useProjectContext();
    const projectId = currentProject?.id ?? null;

    const query = useQuery({
      queryKey: singleKey,
      queryFn: () => fetchSingle<T>(endpoint, id!, singleItemField, projectId),
      enabled: enabled && !!id,
      // Only override if explicitly specified, otherwise use global defaults
      ...(staleTime !== undefined && { staleTime }),
      ...(gcTime !== undefined && { gcTime }),
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      // Note: Removed placeholderData to ensure fresh data is shown immediately after fetch
    });

    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: singleKey, refetchType: 'all' });

    const isInitialLoading = query.isPending && query.isFetching && !isRestoring;

    return {
      data: query.data,
      isLoading: isInitialLoading,
      isPending: query.isPending,
      isRestoring,
      error: query.error as Error | null,
      refetch: query.refetch,
      invalidate,
    };
  }

  function useMutations() {
    const queryClient = useQueryClient();
    const { currentProject } = useProjectContext();
    const projectId = currentProject?.id ?? null;

    const create = useMutation({
      mutationFn: async (data: CreateData) => {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (projectId) headers["x-project-id"] = projectId;

        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || "Failed to create");
        }
        return response.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey, refetchType: 'all' });
      },
    });

    const update = useMutation({
      mutationFn: async (data: UpdateData) => {
        const { id, ...updateData } = data as unknown as { id: string; [key: string]: unknown };
        
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (projectId) headers["x-project-id"] = projectId;

        const response = await fetch(`${endpoint}/${id}`, {
          method: "PUT",
          headers,
          body: JSON.stringify(updateData),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || "Failed to update");
        }
        return response.json();
      },
      ...createUpdateOptimisticHandlers<T>(queryClient, queryKey, singleQueryKey),
    });

    const remove = useMutation({
      mutationFn: async (id: string) => {
        const headers: Record<string, string> = {};
        if (projectId) headers["x-project-id"] = projectId;

        const response = await fetch(`${endpoint}/${id}`, {
          method: "DELETE",
          headers,
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || "Failed to delete");
        }
        return response.json();
      },
      ...createDeleteOptimisticHandlers<T>(queryClient, queryKey),
    });

    return {
      create,
      update,
      remove,
      // Aliases for backward compatibility
      delete: remove,
    };
  }

  return {
    useList,
    useSingle,
    useMutations,
    queryKey,
    singleQueryKey,
    getListQueryKey,
  };
}

export function isPaginatedResponse<T>(
  data: unknown
): data is PaginatedResponse<T> {
  return (
    data !== null &&
    typeof data === "object" &&
    "data" in data &&
    Array.isArray((data as Record<string, unknown>).data) &&
    "pagination" in data &&
    typeof (data as Record<string, unknown>).pagination === "object"
  );
}
