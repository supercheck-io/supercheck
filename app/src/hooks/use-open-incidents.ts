import { useQuery } from "@tanstack/react-query";
import { useProjectContext } from "./use-project-context";
import { isOpenIncident } from "@/lib/dashboard/recent-failures";

export interface OpenIncident {
  id: string;
  incidentNumber: number;
  title: string;
  severity: string;
  status: string;
  primaryServiceName: string | null;
  updatedAt: string;
}

export type OpenIncidentsResult =
  | { available: true; incidents: OpenIncident[] }
  | { available: false };

/**
 * Open (unresolved) SRE incidents for the current project. The endpoint is
 * permission- and feature-gated, so any non-OK response (401/402/403/404/5xx)
 * resolves to `available: false` and the dashboard hides the panel.
 */
export async function fetchOpenIncidents(projectId: string | null = null): Promise<OpenIncidentsResult> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (projectId) headers["x-project-id"] = projectId;
    const response = await fetch("/api/sre/incidents?status=open", {
      headers,
    });
    if (!response.ok) return { available: false };
    const body = (await response.json()) as { incidents?: OpenIncident[] };
    const incidents = Array.isArray(body.incidents)
      ? body.incidents.filter(isOpenIncident)
      : [];
    return { available: true, incidents };
  } catch {
    return { available: false };
  }
}

export function useOpenIncidents() {
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;

  return useQuery({
    queryKey: ["dashboard", "open-incidents", projectId],
    queryFn: () => fetchOpenIncidents(projectId),
    enabled: !!projectId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    // Live counts: the app-wide defaults (30 min stale, no refetch on mount, 24 h persistence)
    // would keep showing the incidents of an earlier visit.
    refetchOnMount: true,
    meta: { persist: false },
  });
}
