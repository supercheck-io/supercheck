"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { APP_CONFIG_QUERY_KEY, fetchAppConfig } from "@/hooks/use-app-config";
import { ADMIN_STATUS_QUERY_KEY, fetchAdminStatus } from "@/hooks/use-admin-status";
import { SUBSCRIPTION_STATUS_QUERY_KEY, fetchSubscriptionStatus } from "@/components/subscription-guard";
import { useProjectContext } from "@/hooks/use-project-context";
import { getMonitorsListQueryKey } from "@/hooks/use-monitors";
import { getRunsListQueryKey } from "@/hooks/use-runs";
import { getStatusPagesListQueryKey } from "@/hooks/use-status-pages";
import { getNotificationProvidersQueryKey, getAlertsHistoryQueryKey } from "@/hooks/use-alerts";
import { getTagsListQueryKey } from "@/hooks/use-tags";
import { getRequirementsListQueryKey } from "@/hooks/use-requirements";
import { getTestsListQueryKey } from "@/hooks/use-tests";
import { getJobsListQueryKey } from "@/hooks/use-jobs";

// NOTE: Variables component uses manual fetch, not React Query.
// Prefetch removed - would warm a cache that's never read.
// TODO: Refactor Variables to use React Query for full prefetch benefit.

/**
 * DataPrefetcher - Parallel data prefetching for critical app data
 *
 * PERFORMANCE OPTIMIZATION:
 * This component starts fetching all critical data in parallel as soon as
 * the app mounts, eliminating waterfall dependencies between components.
 *
 * Phase 1 - Immediate (on mount):
 * - App config (hosting mode, auth providers)
 * - Admin status (super admin, org admin)
 * - Subscription status (for cloud mode)
 *
 * Phase 2 - Immediately when project context is available:
 * - Tests list (for Tests page and sidebar)
 * - Jobs list (for Jobs page and sidebar)
 * - Monitors list (for Monitors page and sidebar)
 * - Variables (for Variables page)
 * - Status Pages (for Status Pages page)
 * - Notification Providers (for Alerts page)
 * - Alert History (for Alerts page)
 *
 * CRITICAL: Phase 2 runs IMMEDIATELY (no delay) to ensure data is prefetched
 * BEFORE page components mount and start their own fetches.
 */
export function DataPrefetcher() {
  const queryClient = useQueryClient();
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;

  // Track which projectId we've already prefetched for
  const prefetchedProjectIdRef = useRef<string | null>(null);

  // Phase 1: Prefetch critical auth/config data immediately
  useEffect(() => {
    const prefetchPhase1 = async () => {
      const prefetches = [
        // App config - needed by SubscriptionGuard
        queryClient.prefetchQuery({
          queryKey: APP_CONFIG_QUERY_KEY,
          queryFn: fetchAppConfig,
          staleTime: 5 * 60 * 1000,
        }),

        // Admin status - needed by sidebar
        queryClient.prefetchQuery({
          queryKey: ADMIN_STATUS_QUERY_KEY,
          queryFn: fetchAdminStatus,
          staleTime: 5 * 60 * 1000,
        }),

        // Subscription status - needed by SubscriptionGuard
        queryClient.prefetchQuery({
          queryKey: SUBSCRIPTION_STATUS_QUERY_KEY,
          queryFn: fetchSubscriptionStatus,
          staleTime: 5 * 60 * 1000,
        }),
      ];

      await Promise.allSettled(prefetches);
    };

    prefetchPhase1();
  }, [queryClient]);

  // Phase 2: Prefetch entity lists IMMEDIATELY when project context is available
  // CRITICAL: No delay - this must run BEFORE page components start their own fetches
  useEffect(() => {
    if (!projectId) return;

    // Skip if we've already prefetched for this project
    if (prefetchedProjectIdRef.current === projectId) return;
    prefetchedProjectIdRef.current = projectId;

    /**
     * Helper to safely fetch JSON with proper error handling
     * Returns empty object on failure to prevent React Query errors
     */
    const safeFetch = async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) {
        console.debug(`[DataPrefetcher] Prefetch failed for ${url}: ${response.status}`);
        return {};
      }
      return response.json();
    };

    // PERFORMANCE FIX: Run prefetch IMMEDIATELY - no requestIdleCallback or setTimeout
    // The previous implementation delayed prefetching by up to 3 seconds, which allowed
    // page components to mount and start their own fetches first, causing loading spinners.
    const prefetchPhase2 = async () => {
      const entityPrefetches = [
        // Runs list - warm cache for Runs page
        // Uses short staleTime for stale-while-revalidate pattern
        queryClient.prefetchQuery({
          queryKey: getRunsListQueryKey(projectId),
          queryFn: () => safeFetch("/api/runs"),
          staleTime: 5 * 1000, // 5 seconds - matches useRuns
        }),

        // Requirements list - warm cache for Requirements page
        queryClient.prefetchQuery({
          queryKey: getRequirementsListQueryKey(projectId),
          queryFn: () => safeFetch("/api/requirements"),
          staleTime: 60 * 1000,
        }),

        // Tests list - warm cache for Tests page
        queryClient.prefetchQuery({
          queryKey: getTestsListQueryKey(projectId),
          queryFn: () => safeFetch("/api/tests"),
          staleTime: 60 * 1000,
        }),

        // Jobs list - warm cache for Jobs page
        queryClient.prefetchQuery({
          queryKey: getJobsListQueryKey(projectId),
          queryFn: () => safeFetch("/api/jobs"),
          staleTime: 60 * 1000,
        }),

        // Monitors list - warm cache for Monitors page
        queryClient.prefetchQuery({
          queryKey: getMonitorsListQueryKey(projectId),
          queryFn: () => safeFetch("/api/monitors"),
          staleTime: 30 * 1000,
        }),

        // Status Pages - warm cache for Status Pages page
        // FIXED: Use correct query key via helper to ensure 100% match with hook
        queryClient.prefetchQuery({
          queryKey: getStatusPagesListQueryKey(projectId),
          queryFn: () => safeFetch("/api/status-pages"),
          staleTime: 60 * 1000,
        }),

        // NOTE: Variables prefetch removed - component uses manual fetch, not React Query.
        // TODO: Add back when Variables is refactored to use React Query.


        // Notification Providers - warm cache for Alerts page and Monitor/Job create forms
        queryClient.prefetchQuery({
          queryKey: getNotificationProvidersQueryKey(projectId),
          queryFn: () => safeFetch("/api/notification-providers"),
          staleTime: 60 * 1000,
        }),

        // Alert History - warm cache for Alerts page
        queryClient.prefetchQuery({
          queryKey: getAlertsHistoryQueryKey(projectId),
          queryFn: () => safeFetch("/api/alerts/history"),
          staleTime: 60 * 1000,
        }),

        // Tags - warm cache for Test creation and tagging
        // CONSISTENCY: Uses project-scoped query key matching useTags hook
        queryClient.prefetchQuery({
          queryKey: getTagsListQueryKey(projectId),
          queryFn: () => safeFetch("/api/tags"),
          staleTime: 60 * 1000,
        }),
      ];

      await Promise.allSettled(entityPrefetches);
    };

    // Execute immediately - no delay!
    prefetchPhase2();
  }, [queryClient, projectId]);

  // This component doesn't render anything - it's just for side effects
  return null;
}
