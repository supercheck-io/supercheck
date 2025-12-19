"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { APP_CONFIG_QUERY_KEY, fetchAppConfig } from "@/hooks/use-app-config";
import { ADMIN_STATUS_QUERY_KEY, fetchAdminStatus } from "@/hooks/use-admin-status";
import { SUBSCRIPTION_STATUS_QUERY_KEY, fetchSubscriptionStatus } from "@/components/subscription-guard";

/**
 * DataPrefetcher - Parallel data prefetching for critical app data
 *
 * PERFORMANCE OPTIMIZATION:
 * This component starts fetching all critical data in parallel as soon as
 * the app mounts, eliminating waterfall dependencies between components.
 *
 * Data fetched in parallel:
 * - App config (hosting mode, auth providers)
 * - Admin status (super admin, org admin)
 * - Subscription status (for cloud mode)
 *
 * This doesn't block rendering - it just warms the React Query cache
 * so that when guards and components need this data, it's already available.
 *
 * NOTE: Uses shared fetch functions from respective hooks to maintain DRY principle.
 */
export function DataPrefetcher() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Prefetch all critical data in parallel immediately on mount
    // These will populate the React Query cache for other components

    const prefetchAll = async () => {
      // Start all prefetches simultaneously - no awaiting between them
      // Uses shared fetch functions from respective modules to avoid duplication
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
        // Only prefetch, guard will decide if it's needed based on hosting mode
        queryClient.prefetchQuery({
          queryKey: SUBSCRIPTION_STATUS_QUERY_KEY,
          queryFn: fetchSubscriptionStatus,
          staleTime: 5 * 60 * 1000,
        }),
      ];

      // Execute all prefetches in parallel
      await Promise.allSettled(prefetches);
    };

    prefetchAll();
  }, [queryClient]);

  // This component doesn't render anything - it's just for side effects
  return null;
}
