export const SRE_QUERY_KEYS = {
  all: ["sre"] as const,
  incidents: ["sre", "incidents"] as const,
  incidentAnalytics: ["sre", "incident-analytics"] as const,
  incidentDetails: ["sre", "incident-detail"] as const,
  incidentTimeline: ["sre", "incident-timeline"] as const,
  incidentAssignees: ["sre", "incident-assignees"] as const,
  similarIncidents: ["sre", "similar-incidents"] as const,
  services: ["sre", "services"] as const,
  serviceDetails: ["sre", "service-detail"] as const,
  copilotHistories: ["sre", "copilot-histories"] as const,
  admin: ["sre", "admin"] as const,
};

export function getSreIncidentsQueryKey(projectId: string | null) {
  return [...SRE_QUERY_KEYS.incidents, projectId] as const;
}

export function getSreIncidentAnalyticsQueryKey(projectId: string | null) {
  return [...SRE_QUERY_KEYS.incidentAnalytics, projectId] as const;
}

export function getSreIncidentDetailQueryKey(
  projectId: string | null,
  incidentId: string,
) {
  return [...SRE_QUERY_KEYS.incidentDetails, projectId, incidentId] as const;
}

export function getSreIncidentTimelineQueryKey(
  projectId: string | null,
  incidentId: string,
) {
  return [...SRE_QUERY_KEYS.incidentTimeline, projectId, incidentId] as const;
}

export function getSreIncidentAssigneesQueryKey(projectId: string | null) {
  return [...SRE_QUERY_KEYS.incidentAssignees, projectId] as const;
}

export function getSreServiceDetailQueryKey(
  projectId: string | null,
  serviceId: string,
) {
  return [...SRE_QUERY_KEYS.serviceDetails, projectId, serviceId] as const;
}

export function getSreCopilotHistoriesQueryKey(projectId: string | null) {
  return [...SRE_QUERY_KEYS.copilotHistories, projectId] as const;
}

export function getSreAdminQueryKey(
  projectId: string | null,
  resource:
    | "setup"
    | "services"
    | "integrations"
    | "diagnostic-recipes"
    | "private-agents",
) {
  return [...SRE_QUERY_KEYS.admin, projectId, resource] as const;
}

export function getSreSimilarIncidentsQueryKey(
  projectId: string | null,
  incidentId: string,
) {
  return [...SRE_QUERY_KEYS.similarIncidents, projectId, incidentId] as const;
}
