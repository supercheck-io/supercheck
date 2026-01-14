"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { APP_CONFIG_QUERY_KEY, fetchAppConfig } from "@/hooks/use-app-config";
import { ADMIN_STATUS_QUERY_KEY, fetchAdminStatus } from "@/hooks/use-admin-status";
import { SUBSCRIPTION_STATUS_QUERY_KEY, fetchSubscriptionStatus } from "@/components/subscription-guard";
import { getDashboardQueryKey, fetchDashboard } from "@/hooks/use-dashboard";
import { useProjectContext } from "@/hooks/use-project-context";

/**
 * DataPrefetcher - Minimal prefetch for essential data
 * 
 * Strategy:
 * - Phase 1: Auth/Config (needed everywhere)
 * - Phase 2: Landing Page Data (only if on landing page)
 * 
 * This approach avoids overwhelming the browser while ensuring
 * the most critical "first paint" data is ready.
 */
export function DataPrefetcher() {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { currentProject } = useProjectContext();
  const didPrefetchAuth = useRef(false);
  const didPrefetchDashboard = useRef(false);

  // Phase 1: Essential Auth/Config (runs once on mount)
  useEffect(() => {
    if (didPrefetchAuth.current) return;
    didPrefetchAuth.current = true;

    queryClient.prefetchQuery({
      queryKey: APP_CONFIG_QUERY_KEY,
      queryFn: fetchAppConfig,
      staleTime: Infinity
    });
    queryClient.prefetchQuery({
      queryKey: ADMIN_STATUS_QUERY_KEY,
      queryFn: fetchAdminStatus,
      staleTime: 5 * 60 * 1000
    });
    queryClient.prefetchQuery({
      queryKey: SUBSCRIPTION_STATUS_QUERY_KEY,
      queryFn: fetchSubscriptionStatus,
      staleTime: 5 * 60 * 1000
    });
  }, [queryClient]);

  // Phase 2: Smart Dashboard Prefetch
  // Only runs if:
  // 1. We have a project context
  // 2. We are on the dashboard page ("/")
  // 3. We haven't prefetched yet
  useEffect(() => {
    if (!currentProject || didPrefetchDashboard.current) return;

    // SMART PREFETCH: Only prefetch dashboard data if we are actually ON the dashboard
    // This prevents "overwhelming" the browser on other pages (e.g. while testing)
    // but ensures the landing page loads instantly.
    if (pathname === "/" || pathname === `/project/${currentProject.slug}`) {
      didPrefetchDashboard.current = true;

      queryClient.prefetchQuery({
        queryKey: getDashboardQueryKey(currentProject.id),
        queryFn: fetchDashboard,
        staleTime: 60 * 1000 // Match useDashboard staleTime
      });
    }
  }, [queryClient, currentProject, pathname]);

  return null;
}
