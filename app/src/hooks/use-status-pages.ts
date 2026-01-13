import { createDataHook, type PaginatedResponse } from "./lib/create-data-hook";

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

export const STATUS_PAGES_QUERY_KEY = ["statusPages"] as const;
export const STATUS_PAGE_QUERY_KEY = ["statusPage"] as const;

export function getStatusPagesListQueryKey(projectId: string | null) {
  // Matches createDataHook's getListQueryKey logic: [...key, projectId, filtersJson]
  // Uses JSON string "{}" for empty filters to ensure cache key matching
  return [...STATUS_PAGES_QUERY_KEY, projectId, "{}"] as const;
}

const statusPagesHook = createDataHook<StatusPage, CreateStatusPageData, UpdateStatusPageData>({
  queryKey: STATUS_PAGES_QUERY_KEY,
  endpoint: "/api/status-pages",
  refetchOnWindowFocus: false,
  singleItemField: "statusPage",
});

export interface UseStatusPagesOptions {
  enabled?: boolean;
}

export function useStatusPages(options: UseStatusPagesOptions = {}) {
  const result = statusPagesHook.useList(options as UseStatusPagesOptions & { [key: string]: unknown });

  return {
    ...result,
    statusPages: result.items,
    loading: result.isLoading,
  };
}

export function useStatusPage(statusPageId: string | null) {
  return statusPagesHook.useSingle(statusPageId);
}

export function useStatusPageMutations() {
  const baseMutations = statusPagesHook.useMutations();

  return {
    createStatusPage: baseMutations.create,
    updateStatusPage: baseMutations.update,
    deleteStatusPage: baseMutations.remove,
  };
}

import { useQuery, useQueryClient, useIsRestoring } from "@tanstack/react-query";
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

export function useStatusPageDetail(statusPageId: string | null) {
  const queryClient = useQueryClient();
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;
  const isRestoring = useIsRestoring();

  const queryKey = [...STATUS_PAGE_QUERY_KEY, statusPageId, "detail"];

  const query = useQuery<StatusPageDetailResponse>({
    queryKey,
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
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey, refetchType: 'all' });

  const isInitialLoading = query.isPending && query.isFetching && !isRestoring;

  return {
    data: query.data,
    statusPage: query.data?.statusPage ?? null,
    components: query.data?.components ?? [],
    monitors: query.data?.monitors ?? [],
    canUpdate: query.data?.canUpdate ?? false,
    isLoading: isInitialLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
    invalidate,
  };
}

