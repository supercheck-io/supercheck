"use client";

import { useEffect, useRef } from "react";
import { useIsRestoring, useQueryClient } from "@tanstack/react-query";
import { useProjectContext } from "@/hooks/use-project-context";
import { APP_CONFIG_QUERY_KEY, fetchAppConfig } from "@/hooks/use-app-config";
import { ADMIN_STATUS_QUERY_KEY, fetchAdminStatus } from "@/hooks/use-admin-status";
import { getTestsListQueryKey } from "@/hooks/use-tests";
import { getJobsListQueryKey } from "@/hooks/use-jobs";
import { getRunsListQueryKey } from "@/hooks/use-runs";
import { getMonitorsListQueryKey } from "@/hooks/use-monitors";
import { getRequirementsListQueryKey } from "@/hooks/use-requirements";
import { getStatusPagesListQueryKey } from "@/hooks/use-status-pages";
import { getNotificationProvidersQueryKey, fetchNotificationProviders } from "@/hooks/use-alerts";
import {
  ORG_DETAILS_QUERY_KEY, ORG_MEMBERS_QUERY_KEY, ORG_PROJECTS_QUERY_KEY,
  fetchOrgDetails, fetchOrgMembers, fetchOrgProjects,
} from "@/hooks/use-organization";
const STALE_TIME = {
  INFINITE: Infinity,
  LONG: 5 * 60 * 1000,    // 5 min
  MEDIUM: 60 * 1000,      // 1 min
  SHORT: 30 * 1000,       // 30 sec
  REALTIME: 5 * 1000,     // 5 sec
};

// Longest the next-page prefetch waits for the current page's own requests to finish.
const PREFETCH_MAX_WAIT_MS = 1500;

export function DataPrefetcher() {
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();
  const { currentProject } = useProjectContext();
  const didPrefetch = useRef({ auth: false, sidebar: false });

  useEffect(() => {
    if (isRestoring || didPrefetch.current.auth) return;
    didPrefetch.current.auth = true;

    const prefetch = (qk: readonly unknown[], fn: () => Promise<unknown>, st: number) =>
      queryClient.prefetchQuery({ queryKey: qk, queryFn: fn, staleTime: st });

    prefetch(APP_CONFIG_QUERY_KEY, fetchAppConfig, STALE_TIME.INFINITE);
    prefetch(ADMIN_STATUS_QUERY_KEY, fetchAdminStatus, STALE_TIME.LONG);
  }, [queryClient, isRestoring]);

  // No dashboard prefetch: the dashboard page reads its data on the server and passes it down.

  useEffect(() => {
    if (isRestoring || !currentProject || didPrefetch.current.sidebar) return;
    const prefetched = didPrefetch.current;
    prefetched.sidebar = true;

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
    let fired = false;
    // Measured from when the cache finished restoring (this effect only runs after that), not from page load.
    const mountedAt = performance.now();
    const run = () => {
      fired = true;
      // Development only: how long after mount the next-page prefetch went out.
      if (process.env.NODE_ENV === "development") {
        console.debug(`[DataPrefetcher] next-page prefetch started ${Math.round(performance.now() - mountedAt)}ms after mount`);
      }
      prefetch(getTestsListQueryKey(projectId), fetchWithProject("/api/tests"), STALE_TIME.LONG);
      prefetch(getJobsListQueryKey(projectId), fetchWithProject("/api/jobs"), STALE_TIME.LONG);
      prefetch(getRunsListQueryKey(projectId), fetchWithProject("/api/runs"), STALE_TIME.REALTIME);
      prefetch(getMonitorsListQueryKey(projectId), fetchWithProject("/api/monitors"), STALE_TIME.SHORT);
      prefetch(getRequirementsListQueryKey(projectId), fetchWithProject("/api/requirements"), STALE_TIME.LONG);
      prefetch(getStatusPagesListQueryKey(projectId), fetchWithProject("/api/status-pages"), STALE_TIME.LONG);
      prefetch(getNotificationProvidersQueryKey(projectId), () => fetchNotificationProviders(projectId), STALE_TIME.LONG);
      // No org stats here: it counts every resource in the org, 403s for non-admins, and only the org admin
      // page reads it (its sidebar link prefetches it on hover).
      prefetch(ORG_DETAILS_QUERY_KEY, fetchOrgDetails, STALE_TIME.LONG);
      prefetch(ORG_MEMBERS_QUERY_KEY, fetchOrgMembers, STALE_TIME.LONG);
      prefetch(ORG_PROJECTS_QUERY_KEY, fetchOrgProjects, STALE_TIME.LONG);
    };

    // These are guesses about the next page. Firing them at mount made the page the user is on queue
    // behind eleven other requests, so wait until its own requests settle (or a cap), then go idle.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    let quietCheck: ReturnType<typeof setTimeout> | undefined;
    let idle: number | undefined;
    // The same API that scheduled the run must cancel it.
    let useNativeIdle = false;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      unsubscribe?.();
      clearTimeout(timer);
      clearTimeout(quietCheck);
      useNativeIdle = "requestIdleCallback" in window && "cancelIdleCallback" in window;
      idle = useNativeIdle
        ? window.requestIdleCallback(run, { timeout: 2000 })
        : (setTimeout(run, 500) as unknown as number);
    };
    // A query is added just before it starts fetching, so confirm the quiet after a short pause.
    const hasPendingFirstLoad = () =>
      queryClient.isFetching({ predicate: (q) => q.state.status === "pending" }) > 0;
    const startWhenQuiet = () => {
      // A first load holds the batch. Cache updates for already-loaded data (polling, refetches)
      // must not push an armed quiet check back, so it is only re-armed when none is waiting.
      if (hasPendingFirstLoad()) {
        clearTimeout(quietCheck);
        quietCheck = undefined;
        return;
      }
      if (quietCheck !== undefined) return;
      quietCheck = setTimeout(() => {
        quietCheck = undefined;
        if (!hasPendingFirstLoad()) start();
      }, 300);
    };
    unsubscribe = queryClient.getQueryCache().subscribe(startWhenQuiet);
    timer = setTimeout(start, PREFETCH_MAX_WAIT_MS);
    startWhenQuiet();
    return () => {
      started = true;
      unsubscribe?.();
      clearTimeout(timer);
      clearTimeout(quietCheck);
      if (idle !== undefined) {
        if (useNativeIdle) window.cancelIdleCallback(idle);
        else clearTimeout(idle);
      }
      if (!fired) prefetched.sidebar = false;
    };
  }, [queryClient, currentProject, isRestoring]);

  return null;
}
