"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { getSreCopilotChatHistories } from "@/actions/sre-ai";
import {
  getSreIncidentAnalytics,
  getSreIncidentDetails,
  getSreIncidents,
} from "@/actions/sre-incidents";
import {
  getSreIncidentAssignees,
  getSreIncidentTimeline,
} from "@/actions/sre-incident-lifecycle";
import { getSreSimilarIncidents } from "@/actions/sre-similar-incidents";
import { getSreServiceDetail, getSreServices } from "@/actions/sre-services";
import { useProjectContext } from "@/hooks/use-project-context";
import {
  getSreCopilotHistoriesQueryKey,
  getSreIncidentAnalyticsQueryKey,
  getSreIncidentAssigneesQueryKey,
  getSreIncidentDetailQueryKey,
  getSreIncidentTimelineQueryKey,
  getSreIncidentsQueryKey,
  getSreSimilarIncidentsQueryKey,
  getSreServiceDetailQueryKey,
} from "@/lib/sre/query-keys";

const MEMORY_ONLY_QUERY = { persist: false } as const;

export function useSreIncidents(scope: "active" | "all" = "active") {
  const { projectId } = useProjectContext();
  return useQuery({
    // Scope is appended so invalidating getSreIncidentsQueryKey(projectId) hits both.
    queryKey: [...getSreIncidentsQueryKey(projectId), scope],
    queryFn: () => getSreIncidents({ scope }),
    // Keep the list mounted (and its filters) while the other scope loads.
    placeholderData: keepPreviousData,
    enabled: Boolean(projectId),
    staleTime: 30_000,
    meta: MEMORY_ONLY_QUERY,
  });
}

export function useSreIncidentAnalytics() {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: getSreIncidentAnalyticsQueryKey(projectId),
    queryFn: getSreIncidentAnalytics,
    enabled: Boolean(projectId),
    staleTime: 60_000,
    meta: MEMORY_ONLY_QUERY,
  });
}

export function useSreIncidentPageData(incidentId: string) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: getSreIncidentDetailQueryKey(projectId, incidentId),
    queryFn: async () => {
      const [incidentResult, servicesResult] = await Promise.all([
        getSreIncidentDetails(incidentId),
        getSreServices(),
      ]);
      return { incidentResult, servicesResult };
    },
    enabled: Boolean(projectId && incidentId),
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.incidentResult.detail?.latestInvestigation?.status ===
      "running"
        ? 5_000
        : false,
    meta: MEMORY_ONLY_QUERY,
  });
}

export function useSreIncidentTimeline(incidentId: string) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: getSreIncidentTimelineQueryKey(projectId, incidentId),
    queryFn: () => getSreIncidentTimeline(incidentId),
    enabled: Boolean(projectId && incidentId),
    staleTime: 15_000,
    meta: MEMORY_ONLY_QUERY,
  });
}

/** History changes rarely: cached for minutes and never part of the investigation polling. */
export function useSreSimilarIncidents(incidentId: string) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: getSreSimilarIncidentsQueryKey(projectId, incidentId),
    queryFn: () => getSreSimilarIncidents(incidentId),
    enabled: Boolean(projectId && incidentId),
    staleTime: 5 * 60_000,
    meta: MEMORY_ONLY_QUERY,
  });
}

export function useSreIncidentAssignees(enabled = true) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: getSreIncidentAssigneesQueryKey(projectId),
    queryFn: getSreIncidentAssignees,
    enabled: Boolean(projectId) && enabled,
    staleTime: 60_000,
    meta: MEMORY_ONLY_QUERY,
  });
}

export function useSreServiceDetail(serviceId: string) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: getSreServiceDetailQueryKey(projectId, serviceId),
    queryFn: () => getSreServiceDetail({ id: serviceId }),
    enabled: Boolean(projectId && serviceId),
    staleTime: 60_000,
    meta: MEMORY_ONLY_QUERY,
  });
}

export function useSreCopilotHistories(options?: { enabled?: boolean }) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: getSreCopilotHistoriesQueryKey(projectId),
    queryFn: getSreCopilotChatHistories,
    enabled: Boolean(projectId) && options?.enabled !== false,
    staleTime: 30_000,
    meta: MEMORY_ONLY_QUERY,
  });
}
