/**
 * Generic Data Hook Factory
 *
 * Creates standardized React Query hooks for entity CRUD operations.
 * Eliminates repeated code patterns across entity hooks (jobs, runs, monitors, tests).
 *
 * Features:
 * - Standardized query keys with project scoping
 * - Consistent response format handling ({ data, pagination })
 * - Optimistic updates for mutations
 * - Automatic cache invalidation
 * - Type-safe with generics
 */

import {
  useQuery,
  useQueryClient,
  useMutation,
  QueryClient,

} from "@tanstack/react-query";
import { useProjectContext } from "../use-project-context";

// ============================================================================
// TYPES
// ============================================================================

/** Standard paginated response format from APIs */
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

/** Configuration for creating a data hook */
export interface DataHookConfig<T, CreateData, UpdateData> {
  /** Base query key (e.g., ["jobs"]) */
  queryKey: readonly string[];
  /** API endpoint (e.g., "/api/jobs") */
  endpoint: string;
  /** Stale time in ms (default: 60000 = 1 minute) */
  staleTime?: number;
  /** Garbage collection time in ms (default: 300000 = 5 minutes) */
  gcTime?: number;
  /** Whether to refetch on window focus (default: true) */
  refetchOnWindowFocus?: boolean;

  /** Function to generate optimistic item for create (optional) */
  generateOptimisticItem?: (data: CreateData) => Partial<T>;
  /** Field name in single item response (e.g., "job" for { job: {...} }) */
  singleItemField?: string;
}

/** Base options for list queries */
export interface ListQueryOptions {
  page?: number;
  pageSize?: number;
  enabled?: boolean;
}

/** Options for single item queries */
export interface SingleQueryOptions {
  enabled?: boolean;
}

// ============================================================================
// FETCH UTILITIES
// ============================================================================

/**
 * Build URL search params from an options object
 */
function buildSearchParams(
  options: Record<string, unknown>,
  pageParamName = "limit"
): URLSearchParams {
  const params = new URLSearchParams();

  Object.entries(options).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (key === "enabled") return; // Skip hook options

    // Map pageSize to limit for API compatibility
    if (key === "pageSize") {
      params.set(pageParamName, String(value));
    } else {
      params.set(key, String(value));
    }
  });

  return params;
}

/**
 * Generic fetch function for list endpoints
 * Expects standardized { data, pagination } response format from all APIs.
 */
async function fetchList<T>(
  endpoint: string,
  options: Record<string, unknown>
): Promise<PaginatedResponse<T>> {
  const params = buildSearchParams(options);
  const url = params.toString() ? `${endpoint}?${params}` : endpoint;

  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Generic fetch function for single item endpoints
 */
async function fetchSingle<T>(
  endpoint: string,
  id: string,
  singleItemField?: string
): Promise<T> {
  const response = await fetch(`${endpoint}/${id}`, {
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  // Extract item from response if field specified (e.g., { job: {...} } -> {...})
  if (singleItemField && data[singleItemField]) {
    return data[singleItemField];
  }

  return data;
}

// ============================================================================
// OPTIMISTIC UPDATE UTILITIES
// ============================================================================

/**
 * Create optimistic update handlers for delete mutation
 */
function createDeleteOptimisticHandlers<T extends { id: string }>(
  queryClient: QueryClient,
  queryKey: readonly string[]
) {
  return {
    onMutate: async (id: string) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot previous value
      const previous = queryClient.getQueriesData({ queryKey });

      // Optimistically remove item from all matching queries
      queryClient.setQueriesData<PaginatedResponse<T>>(
        { queryKey },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.filter((item) => item.id !== id),
            pagination: {
              ...old.pagination,
              total: Math.max(0, old.pagination.total - 1),
            },
          };
        }
      );

      return { previous };
    },
    onError: (_err: unknown, _id: string, context: { previous?: unknown } | undefined) => {
      // Rollback on error
      if (context?.previous) {
        (context.previous as [readonly unknown[], unknown][]).forEach(([key, value]) => {
          queryClient.setQueryData(key, value);
        });
      }
    },
    onSettled: () => {
      // Always refetch after mutation with refetchType: 'all' to ensure data freshness
      // across all matching queries, even if they are currently inactive.
      queryClient.invalidateQueries({ queryKey, refetchType: 'all' });
    },
  };
}

/**
 * Create optimistic update handlers for update mutation
 */
function createUpdateOptimisticHandlers<T extends { id: string }>(
  queryClient: QueryClient,
  queryKey: readonly string[],
  singleQueryKey: readonly string[]
) {
  return {
    onMutate: async (data: { id: string; [key: string]: unknown }) => {
      const { id, ...updates } = data;

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey });
      await queryClient.cancelQueries({ queryKey: [...singleQueryKey, id] });

      // Snapshot previous values
      const previousList = queryClient.getQueriesData({ queryKey });
      const previousSingle = queryClient.getQueryData([...singleQueryKey, id]);

      // Optimistically update item in list queries
      queryClient.setQueriesData<PaginatedResponse<T>>(
        { queryKey },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map((item) =>
              item.id === id ? { ...item, ...updates } : item
            ),
          };
        }
      );

      // Optimistically update single item query
      queryClient.setQueryData<T>([...singleQueryKey, id], (old) => {
        if (!old) return old;
        return { ...old, ...updates };
      });

      return { previousList, previousSingle, id };
    },
    onError: (
      _err: unknown,
      _data: { id: string; [key: string]: unknown },
      context: { previousList?: unknown; previousSingle?: unknown; id?: string } | undefined
    ) => {
      // Rollback list queries
      if (context?.previousList) {
        (context.previousList as [readonly unknown[], unknown][]).forEach(([key, value]) => {
          queryClient.setQueryData(key, value);
        });
      }
      // Rollback single item query
      if (context?.previousSingle && context?.id) {
        queryClient.setQueryData([...singleQueryKey, context.id], context.previousSingle);
      }
    },
    onSettled: (_data: unknown, _err: unknown, variables: { id: string }) => {
      // Use refetchType: 'all' for both list and single item queries to ensure consistency
      queryClient.invalidateQueries({ queryKey, refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: [...singleQueryKey, variables.id], refetchType: 'all' });
    },
  };
}

// ============================================================================
// HOOK FACTORY
// ============================================================================

/**
 * Creates a set of React Query hooks for an entity type.
 *
 * @example
 * ```typescript
 * const { useList: useJobs, useSingle: useJob, useMutations: useJobMutations } = createDataHook<Job>({
 *   queryKey: ["jobs"],
 *   endpoint: "/api/jobs",
 *   staleTime: 60000,
 * });
 * ```
 */
export function createDataHook<
  T extends { id: string },
  CreateData = Partial<T>,
  UpdateData extends { id: string } = { id: string } & Partial<T>
>(config: DataHookConfig<T, CreateData, UpdateData>) {
  const {
    queryKey,
    endpoint,
    staleTime = 60 * 1000,
    gcTime = 5 * 60 * 1000,
    refetchOnWindowFocus = true,

    singleItemField,
  } = config;

  const singleQueryKey = [queryKey[0].replace(/s$/, "")] as const; // "jobs" -> "job"

  // Helper to create project-scoped query key
  const getListQueryKey = (
    projectId: string | null,
    filters?: Record<string, unknown>
  ) => [...queryKey, projectId, filters] as const;

  /**
   * Hook to fetch paginated list of entities
   */
  function useList(options: ListQueryOptions & { [key: string]: unknown } = {}) {
    const { currentProject } = useProjectContext();
    const projectId = currentProject?.id ?? null;
    const queryClient = useQueryClient();

    const { enabled = true, ...filters } = options;

    const query = useQuery({
      queryKey: getListQueryKey(projectId, filters),
      queryFn: () => fetchList<T>(endpoint, filters),
      enabled: enabled && !!projectId,
      staleTime,
      gcTime,
      refetchOnWindowFocus,
      // No polling - data refreshes on page visit or manual refresh
    });

    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey });

    return {
      data: query.data,
      items: query.data?.data ?? [],
      total: query.data?.pagination?.total ?? 0,
      pagination: query.data?.pagination,
      isLoading: query.isLoading,
      isRefetching: query.isRefetching,
      error: query.error as Error | null,
      refetch: query.refetch,
      invalidate,
    };
  }

  /**
   * Hook to fetch a single entity by ID
   */
  function useSingle(id: string | null, options: SingleQueryOptions = {}) {
    const queryClient = useQueryClient();
    const { enabled = true } = options;

    const query = useQuery({
      queryKey: [...singleQueryKey, id],
      queryFn: () => fetchSingle<T>(endpoint, id!, singleItemField),
      enabled: enabled && !!id,
      staleTime: staleTime / 2, // Single items have shorter stale time
      gcTime,
      // No polling - data refreshes on page visit or manual refresh
    });

    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: [...singleQueryKey, id] });

    return {
      data: query.data,
      isLoading: query.isLoading,
      error: query.error as Error | null,
      refetch: query.refetch,
      invalidate,
    };
  }

  /**
   * Hook for entity mutations with optimistic updates
   */
  function useMutations() {
    const queryClient = useQueryClient();

    const create = useMutation({
      mutationFn: async (data: CreateData) => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || "Failed to create");
        }
        return response.json();
      },
      onSuccess: () => {
        // Use refetchType: 'all' to force immediate refetch of all matching queries
        // This ensures new items appear even when navigating to a new page
        queryClient.invalidateQueries({ queryKey, refetchType: 'all' });
      },
    });

    const update = useMutation({
      mutationFn: async (data: UpdateData) => {
        const { id, ...updateData } = data as unknown as { id: string; [key: string]: unknown };
        const response = await fetch(`${endpoint}/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
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
        const response = await fetch(`${endpoint}/${id}`, {
          method: "DELETE",
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
    // Export query keys for external cache invalidation
    queryKey,
    singleQueryKey,
    getListQueryKey,
  };
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if response is a valid paginated response
 */
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
