/**
 * Status Pages Data Hook
 *
 * React Query hook for fetching status pages list with efficient caching.
 * Uses the generic data hook factory for DRY, consistent behavior.
 * Caches data for 60 seconds.
 */

import { createDataHook, type PaginatedResponse } from "./lib/create-data-hook";

// ============================================================================
// TYPES
// ============================================================================

export interface StatusPage {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  pageDescription: string | null;
  headline: string | null;
  supportUrl: string | null;
  timezone: string | null;
  allowPageSubscribers: boolean | null;
  customDomain: string | null;
  customDomainVerified: boolean | null;
  faviconLogo: string | null;
  transactionalLogo: string | null;
  heroCover: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  projectId: string | null;
  organizationId: string;
}

export interface StatusPagesResponse extends PaginatedResponse<StatusPage> {}

interface CreateStatusPageData {
  name: string;
  subdomain: string;
  pageDescription?: string;
  headline?: string;
}

interface UpdateStatusPageData {
  id: string;
  name?: string;
  pageDescription?: string;
  headline?: string;
  status?: string;
}

// ============================================================================
// QUERY KEYS (exported for external cache invalidation)
// ============================================================================

export const STATUS_PAGES_QUERY_KEY = ["statusPages"] as const;
export const STATUS_PAGE_QUERY_KEY = ["statusPage"] as const;

/**
 * Helper to generate the exact query key used by the list hook.
 * This ensures DataPrefetcher and other consumers match the internal key logic.
 */
export function getStatusPagesListQueryKey(projectId: string | null) {
  // Matches createDataHook's getListQueryKey logic: [...key, projectId, filters]
  // Filters default to {} when clean
  return [...STATUS_PAGES_QUERY_KEY, projectId, {}] as const;
}

// ============================================================================
// HOOK FACTORY
// ============================================================================

const statusPagesHook = createDataHook<StatusPage, CreateStatusPageData, UpdateStatusPageData>({
  queryKey: STATUS_PAGES_QUERY_KEY,
  endpoint: "/api/status-pages",
  // Inherits staleTime (5min) and gcTime (24h) from factory defaults
  refetchOnWindowFocus: false, // OPTIMIZED: Prevent aggressive re-fetching on tab switch
  singleItemField: "statusPage",
});

// ============================================================================
// HOOKS
// ============================================================================

export interface UseStatusPagesOptions {
  enabled?: boolean;
}

/**
 * Hook to fetch status pages list with React Query caching.
 * Data is cached for 60 seconds and shared across components.
 */
export function useStatusPages(options: UseStatusPagesOptions = {}) {
  const result = statusPagesHook.useList(options as UseStatusPagesOptions & { [key: string]: unknown });

  return {
    ...result,
    statusPages: result.items, // Alias for component usage
    loading: result.isLoading, // Alias for component usage
  };
}

/**
 * Hook to fetch a single status page by ID with React Query caching.
 */
export function useStatusPage(statusPageId: string | null) {
  return statusPagesHook.useSingle(statusPageId);
}

/**
 * Hook for status page mutations (create, update, delete) with optimistic updates.
 */
export function useStatusPageMutations() {
  const baseMutations = statusPagesHook.useMutations();

  return {
    createStatusPage: baseMutations.create,
    updateStatusPage: baseMutations.update,
    deleteStatusPage: baseMutations.remove,
  };
}

// ============================================================================
// DETAIL PAGE HOOK (custom, returns related data)
// ============================================================================

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useProjectContext } from "./use-project-context";

export interface StatusPageMonitor {
  id: string;
  name: string;
  type: string;
  status?: string;
  target?: string;
}

export interface StatusPageComponent {
  id: string;
  name: string;
  description: string | null;
  status: string;
  monitors: StatusPageMonitor[];
  monitorIds: string[];
  aggregationMethod: string;
  failureThreshold: number;
  showcase: boolean | null;
  onlyShowIfDegraded: boolean | null;
  position: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StatusPageDetailResponse {
  statusPage: StatusPage & {
    cssBodyBackgroundColor?: string | null;
    cssFontColor?: string | null;
    cssLightFontColor?: string | null;
    cssGreens?: string | null;
    cssYellows?: string | null;
    cssOranges?: string | null;
    cssBlues?: string | null;
    cssReds?: string | null;
    cssBorderColor?: string | null;
    cssGraphColor?: string | null;
    cssLinkColor?: string | null;
    cssNoData?: string | null;
    allowIncidentSubscribers?: boolean | null;
    allowEmailSubscribers?: boolean | null;
    allowWebhookSubscribers?: boolean | null;
    allowSlackSubscribers?: boolean | null;
    allowRssFeed?: boolean | null;
    notificationsFromEmail?: string | null;
    notificationsEmailFooter?: string | null;
  };
  components: StatusPageComponent[];
  monitors: StatusPageMonitor[];
  canUpdate: boolean;
}

/**
 * Hook to fetch a single status page with all related data (components, monitors, permissions).
 * Uses a custom query since the response format differs from the generic factory pattern.
 */
export function useStatusPageDetail(statusPageId: string | null) {
  const queryClient = useQueryClient();
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;

  const query = useQuery<StatusPageDetailResponse>({
    queryKey: [...STATUS_PAGE_QUERY_KEY, statusPageId, "detail"],
    queryFn: async () => {
      const response = await fetch(`/api/status-pages/${statusPageId}`, {
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    },
    enabled: !!statusPageId && !!projectId,
    staleTime: 60 * 1000, // 60 seconds\n    // gcTime inherited (24h) for instant back navigation
    refetchOnWindowFocus: false,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [...STATUS_PAGE_QUERY_KEY, statusPageId, "detail"], refetchType: 'all' });

  return {
    data: query.data,
    statusPage: query.data?.statusPage ?? null,
    components: query.data?.components ?? [],
    monitors: query.data?.monitors ?? [],
    canUpdate: query.data?.canUpdate ?? false,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
    invalidate,
  };
}

