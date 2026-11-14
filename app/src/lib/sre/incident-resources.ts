import { and, desc, eq, inArray, ne, or } from "drizzle-orm";

import { monitors, sreIncidentResources, sreIncidents, sreServiceResources, sreServices } from "@/db/schema";
import { liveMonitor } from "@/lib/deletion/visibility";
import { db } from "@/utils/db";

type Executor = Pick<typeof db, "select" | "insert" | "delete">;

export type IncidentResourceRef = { type: "service" | "monitor"; id: string; name: string };

/** Affected services and monitors per incident, at most 50 in all. */
export const MAX_INCIDENT_RESOURCES = 50;

/**
 * Resolves ids to services and monitors of this org and project, with their names.
 * Null when any id is unknown, merged away, being deleted, or belongs elsewhere: the caller answers "not found".
 */
export async function resolveIncidentResources(
  executor: Pick<typeof db, "select">,
  scope: { organizationId: string; projectId: string },
  ids: { serviceIds: string[]; monitorIds: string[] },
): Promise<IncidentResourceRef[] | null> {
  const serviceIds = [...new Set(ids.serviceIds)];
  const monitorIds = [...new Set(ids.monitorIds)];
  const [services, found] = await Promise.all([
    serviceIds.length
      ? executor
          .select({ id: sreServices.id, name: sreServices.name })
          .from(sreServices)
          .where(and(inArray(sreServices.id, serviceIds), eq(sreServices.organizationId, scope.organizationId), eq(sreServices.projectId, scope.projectId), ne(sreServices.status, "merged")))
      : [],
    monitorIds.length
      ? executor
          .select({ id: monitors.id, name: monitors.name })
          .from(monitors)
          .where(and(inArray(monitors.id, monitorIds), eq(monitors.organizationId, scope.organizationId), eq(monitors.projectId, scope.projectId), liveMonitor()))
      : [],
  ]);
  if (services.length !== serviceIds.length || found.length !== monitorIds.length) return null;
  return [
    ...services.map((row) => ({ type: "service" as const, id: row.id, name: row.name })),
    ...found.map((row) => ({ type: "monitor" as const, id: row.id, name: row.name })),
  ];
}

/** Adds rows the incident does not have yet; returns the ones actually added. */
export async function addIncidentResources(executor: Executor, incidentId: string, resources: IncidentResourceRef[]) {
  if (resources.length === 0) return [];
  const inserted = await executor
    .insert(sreIncidentResources)
    .values(resources.map((resource) => ({ incidentId, resourceType: resource.type, resourceId: resource.id })))
    .onConflictDoNothing()
    .returning({ type: sreIncidentResources.resourceType, id: sreIncidentResources.resourceId });
  const added = new Set(inserted.map((row) => `${row.type}:${row.id}`));
  return resources.filter((resource) => added.has(`${resource.type}:${resource.id}`));
}

/**
 * The newest open incident in this project that lists the monitor, or a service the monitor is mapped to,
 * as affected. Triage attaches the monitor's next alert to it instead of opening a duplicate (spec I4).
 * sre_incident_resources has no tenant columns, so the org and project filter is on sre_incidents.
 */
export async function findOpenIncidentListingMonitor(
  executor: Pick<typeof db, "select">,
  input: { organizationId: string; projectId: string; monitorId: string },
) {
  const [row] = await executor
    .select({ id: sreIncidents.id, triageInvestigationRunId: sreIncidents.triageInvestigationRunId })
    .from(sreIncidentResources)
    .innerJoin(sreIncidents, eq(sreIncidents.id, sreIncidentResources.incidentId))
    .where(
      and(
        eq(sreIncidents.organizationId, input.organizationId),
        eq(sreIncidents.projectId, input.projectId),
        ne(sreIncidents.status, "resolved"),
        or(
          and(eq(sreIncidentResources.resourceType, "monitor"), eq(sreIncidentResources.resourceId, input.monitorId)),
          and(
            eq(sreIncidentResources.resourceType, "service"),
            inArray(
              sreIncidentResources.resourceId,
              executor
                .select({ id: sreServiceResources.serviceId })
                .from(sreServiceResources)
                .where(and(eq(sreServiceResources.resourceType, "monitor"), eq(sreServiceResources.resourceId, input.monitorId))),
            ),
          ),
        ),
      ),
    )
    .orderBy(desc(sreIncidents.createdAt))
    .limit(1);
  return row ?? null;
}
