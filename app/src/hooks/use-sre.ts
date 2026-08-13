"use client";

import { useQuery } from "@tanstack/react-query";

import { getSreEvidenceGraphAction } from "@/actions/sre-evidence-graph";
import { getSreStandaloneChatHistories } from "@/actions/sre-ai";
import {
  getSreIncidentAnalytics,
  getSreIncidentDetails,
  getSreIncidents,
} from "@/actions/sre-incidents";
import { getSreServiceDetail, getSreServices } from "@/actions/sre-services";
import { useProjectContext } from "@/hooks/use-project-context";
import {
  getSreEvidenceGraphQueryKey,
  getSreCopilotHistoriesQueryKey,
  getSreIncidentAnalyticsQueryKey,
  getSreIncidentDetailQueryKey,
  getSreIncidentsQueryKey,
  getSreServiceDetailQueryKey,
} from "@/lib/sre/query-keys";

const MEMORY_ONLY_QUERY = { persist: false } as const;

export function useSreIncidents() {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: getSreIncidentsQueryKey(projectId),
    queryFn: getSreIncidents,
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

export function useSreEvidenceGraph() {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: getSreEvidenceGraphQueryKey(projectId),
    queryFn: getSreEvidenceGraphAction,
    enabled: Boolean(projectId),
    staleTime: 30_000,
    meta: MEMORY_ONLY_QUERY,
  });
}

export function useSreCopilotHistories(options?: { enabled?: boolean }) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: getSreCopilotHistoriesQueryKey(projectId),
    queryFn: getSreStandaloneChatHistories,
    enabled: Boolean(projectId) && options?.enabled !== false,
    staleTime: 30_000,
    meta: MEMORY_ONLY_QUERY,
  });
}
