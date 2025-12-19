"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { APP_CONFIG_QUERY_KEY, fetchAppConfig } from "@/hooks/use-app-config";
import { ADMIN_STATUS_QUERY_KEY, fetchAdminStatus } from "@/hooks/use-admin-status";
import { SUBSCRIPTION_STATUS_QUERY_KEY, fetchSubscriptionStatus } from "@/components/subscription-guard";
import { useProjectContext } from "@/hooks/use-project-context";
import { TESTS_QUERY_KEY } from "@/hooks/use-tests";
import { JOBS_QUERY_KEY } from "@/hooks/use-jobs";
import { MONITORS_QUERY_KEY } from "@/hooks/use-monitors";
import { getStatusPages } from "@/actions/get-status-pages";

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
 * Phase 2 - After project context is available:
 * - Tests list (for Tests page and sidebar)
 * - Jobs list (for Jobs page and sidebar)
 * - Monitors list (for Monitors page and sidebar)
 * - Variables (for Variables page)
 * - Status Pages (for Status Pages page)
 *
 * This doesn't block rendering - it just warms the React Query cache
 * so that when components need this data, it's already available.
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

  // Phase 2: Prefetch entity lists after project context is available
  // This runs once per project to warm the cache for sidebar navigation
  useEffect(() => {
    if (!projectId) return;

    // Skip if we've already prefetched for this project
    if (prefetchedProjectIdRef.current === projectId) return;
    prefetchedProjectIdRef.current = projectId;

    const prefetchPhase2 = async () => {
      // Small delay to not compete with initial page render
      await new Promise(resolve => setTimeout(resolve, 500));

      const entityPrefetches = [
        // Tests list - warm cache for Tests page
        queryClient.prefetchQuery({
          queryKey: [...TESTS_QUERY_KEY, projectId, {}],
          queryFn: () => fetch("/api/tests").then(r => r.json()),
          staleTime: 60 * 1000,
        }),

        // Jobs list - warm cache for Jobs page
        queryClient.prefetchQuery({
          queryKey: [...JOBS_QUERY_KEY, projectId, {}],
          queryFn: () => fetch("/api/jobs").then(r => r.json()),
          staleTime: 60 * 1000,
        }),

        // Monitors list - warm cache for Monitors page
        queryClient.prefetchQuery({
          queryKey: [...MONITORS_QUERY_KEY, projectId, {}],
          queryFn: () => fetch("/api/monitors").then(r => r.json()),
          staleTime: 30 * 1000,
        }),

        // Variables - warm cache for Variables page
        queryClient.prefetchQuery({
          queryKey: ["variables", projectId],
          queryFn: () => fetch(`/api/projects/${projectId}/variables`).then(r => r.json()),
          staleTime: 60 * 1000,
        }),

        // Status Pages - warm cache for Status Pages page
        // Uses server action directly since there's no API endpoint
        queryClient.prefetchQuery({
          queryKey: ["status-pages", projectId],
          queryFn: () => getStatusPages(),
          staleTime: 60 * 1000,
        }),
      ];

      await Promise.allSettled(entityPrefetches);
    };

    prefetchPhase2();
  }, [queryClient, projectId]);

  // This component doesn't render anything - it's just for side effects
  return null;
}

