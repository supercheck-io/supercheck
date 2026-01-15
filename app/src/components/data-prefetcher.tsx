"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useProjectContext } from "@/hooks/use-project-context";
import { APP_CONFIG_QUERY_KEY, fetchAppConfig } from "@/hooks/use-app-config";
import { ADMIN_STATUS_QUERY_KEY, fetchAdminStatus } from "@/hooks/use-admin-status";
import { SUBSCRIPTION_STATUS_QUERY_KEY, fetchSubscriptionStatus } from "@/components/subscription-guard";
import { getDashboardQueryKey, fetchDashboard } from "@/hooks/use-dashboard";
import { getTestsListQueryKey } from "@/hooks/use-tests";
import { getJobsListQueryKey } from "@/hooks/use-jobs";
import { getRunsListQueryKey } from "@/hooks/use-runs";
import { getMonitorsListQueryKey } from "@/hooks/use-monitors";
import { getRequirementsListQueryKey } from "@/hooks/use-requirements";
import { getStatusPagesListQueryKey } from "@/hooks/use-status-pages";
import { getNotificationProvidersQueryKey, fetchNotificationProviders } from "@/hooks/use-alerts";
import {
  ORG_STATS_QUERY_KEY, ORG_DETAILS_QUERY_KEY, ORG_MEMBERS_QUERY_KEY, ORG_PROJECTS_QUERY_KEY,
  fetchOrgStats, fetchOrgDetails, fetchOrgMembers, fetchOrgProjects,
} from "@/hooks/use-organization";
const STALE_TIME = {
  INFINITE: Infinity,
  LONG: 5 * 60 * 1000,    // 5 min
  MEDIUM: 60 * 1000,      // 1 min
  SHORT: 30 * 1000,       // 30 sec
  REALTIME: 5 * 1000,     // 5 sec
};

export function DataPrefetcher() {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { currentProject } = useProjectContext();
  const didPrefetch = useRef({ auth: false, dashboard: false, sidebar: false });

  useEffect(() => {
    if (didPrefetch.current.auth) return;
    didPrefetch.current.auth = true;

    const prefetch = (qk: readonly unknown[], fn: () => Promise<unknown>, st: number) =>
      queryClient.prefetchQuery({ queryKey: qk, queryFn: fn, staleTime: st });

    prefetch(APP_CONFIG_QUERY_KEY, fetchAppConfig, STALE_TIME.INFINITE);
    prefetch(ADMIN_STATUS_QUERY_KEY, fetchAdminStatus, STALE_TIME.LONG);
    prefetch(SUBSCRIPTION_STATUS_QUERY_KEY, fetchSubscriptionStatus, STALE_TIME.LONG);
  }, [queryClient]);

  useEffect(() => {
    if (!currentProject || didPrefetch.current.dashboard) return;
    if (pathname === "/" || pathname === `/project/${currentProject.slug}`) {
      didPrefetch.current.dashboard = true;
      queryClient.prefetchQuery({
        queryKey: getDashboardQueryKey(currentProject.id),
        queryFn: fetchDashboard,
        staleTime: STALE_TIME.MEDIUM,
      });
    }
  }, [queryClient, currentProject, pathname]);

  useEffect(() => {
    if (!currentProject || didPrefetch.current.sidebar) return;
    didPrefetch.current.sidebar = true;

    const projectId = currentProject.id;
    const prefetch = (qk: readonly unknown[], fn: () => Promise<unknown>, st: number) =>
      queryClient.prefetchQuery({ queryKey: qk, queryFn: fn, staleTime: st });
    const fetchWithProject = (endpoint: string) => async () => {
      const res = await fetch(endpoint, {
        headers: { "Content-Type": "application/json", "x-project-id": projectId },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };

    prefetch(getTestsListQueryKey(projectId), fetchWithProject("/api/tests"), STALE_TIME.LONG);
    prefetch(getJobsListQueryKey(projectId), fetchWithProject("/api/jobs"), STALE_TIME.LONG);
    prefetch(getRunsListQueryKey(projectId), fetchWithProject("/api/runs"), STALE_TIME.REALTIME);
    prefetch(getMonitorsListQueryKey(projectId), fetchWithProject("/api/monitors"), STALE_TIME.SHORT);
    prefetch(getRequirementsListQueryKey(projectId), fetchWithProject("/api/requirements"), STALE_TIME.LONG);
    prefetch(getStatusPagesListQueryKey(projectId), fetchWithProject("/api/status-pages"), STALE_TIME.LONG);
    prefetch(getNotificationProvidersQueryKey(projectId), () => fetchNotificationProviders(projectId), STALE_TIME.LONG);
    prefetch(ORG_STATS_QUERY_KEY, fetchOrgStats, STALE_TIME.LONG);
    prefetch(ORG_DETAILS_QUERY_KEY, fetchOrgDetails, STALE_TIME.LONG);
    prefetch(ORG_MEMBERS_QUERY_KEY, fetchOrgMembers, STALE_TIME.LONG);
    prefetch(ORG_PROJECTS_QUERY_KEY, fetchOrgProjects, STALE_TIME.LONG);
  }, [queryClient, currentProject]);

  return null;
}
