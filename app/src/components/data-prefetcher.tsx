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
import { getDashboardQueryKey, fetchDashboard } from "@/hooks/use-dashboard";

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function DataPrefetcher() {
  const queryClient = useQueryClient();
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;
  const didPrefetchAuth = useRef(false);
  const didPrefetchProject = useRef<string | null>(null);

  useEffect(() => {
    if (didPrefetchAuth.current) return;
    didPrefetchAuth.current = true;

    queryClient.prefetchQuery({ queryKey: APP_CONFIG_QUERY_KEY, queryFn: fetchAppConfig, staleTime: Infinity });
    queryClient.prefetchQuery({ queryKey: ADMIN_STATUS_QUERY_KEY, queryFn: fetchAdminStatus, staleTime: 5 * 60 * 1000 });
    queryClient.prefetchQuery({ queryKey: SUBSCRIPTION_STATUS_QUERY_KEY, queryFn: fetchSubscriptionStatus, staleTime: 5 * 60 * 1000 });
  }, [queryClient]);

  useEffect(() => {
    if (!projectId || didPrefetchProject.current === projectId) return;
    didPrefetchProject.current = projectId;

    const staleTime = 5 * 60 * 1000;
    
    queryClient.prefetchQuery({ queryKey: getDashboardQueryKey(projectId), queryFn: fetchDashboard, staleTime });
    queryClient.prefetchQuery({ queryKey: getRunsListQueryKey(projectId), queryFn: () => fetchJson("/api/runs"), staleTime });
    queryClient.prefetchQuery({ queryKey: getTestsListQueryKey(projectId), queryFn: () => fetchJson("/api/tests"), staleTime });
    queryClient.prefetchQuery({ queryKey: getJobsListQueryKey(projectId), queryFn: () => fetchJson("/api/jobs"), staleTime });
    queryClient.prefetchQuery({ queryKey: getMonitorsListQueryKey(projectId), queryFn: () => fetchJson("/api/monitors"), staleTime });
    queryClient.prefetchQuery({ queryKey: getRequirementsListQueryKey(projectId), queryFn: () => fetchJson("/api/requirements"), staleTime });
    queryClient.prefetchQuery({ queryKey: getStatusPagesListQueryKey(projectId), queryFn: () => fetchJson("/api/status-pages"), staleTime });
    queryClient.prefetchQuery({ queryKey: getNotificationProvidersQueryKey(projectId), queryFn: () => fetchJson("/api/notification-providers"), staleTime });
    queryClient.prefetchQuery({ queryKey: getAlertsHistoryQueryKey(projectId), queryFn: () => fetchJson("/api/alerts/history"), staleTime });
    queryClient.prefetchQuery({ queryKey: getTagsListQueryKey(projectId), queryFn: () => fetchJson("/api/tags"), staleTime });
  }, [queryClient, projectId]);

  return null;
}
