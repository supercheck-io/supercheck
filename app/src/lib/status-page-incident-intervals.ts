import { asc, inArray } from "drizzle-orm";
import { db } from "@/utils/db";
import { incidentUpdates } from "@/db/schema";

export type StatusChange = { incidentId: string; status: string; at: Date };

/**
 * The periods an incident was open, from its status updates: it opens when created, a "resolved" update closes it
 * and a later non-resolved update reopens it. A trailing open period has no end (it runs until now, or until the
 * incident's resolution time when it is resolved without a resolved update). Times are ISO strings for the client.
 */
export function openIntervals(createdAt: Date, changes: Array<{ status: string; at: Date }>): Array<[string, string | null]> {
  const intervals: Array<[string, string | null]> = [];
  // Posted already resolved: never open, though its first update is stored a moment after the incident.
  let openedAt: Date | null = changes[0]?.status === "resolved" ? null : createdAt;
  for (const change of changes) {
    if (change.status === "resolved" && openedAt) {
      intervals.push([openedAt.toISOString(), change.at.toISOString()]);
      openedAt = null;
    } else if (change.status !== "resolved" && !openedAt) {
      openedAt = change.at;
    }
  }
  if (openedAt) intervals.push([openedAt.toISOString(), null]);
  return intervals;
}

/** Status changes of the given incidents, oldest first, in one query. */
export async function loadStatusChanges(incidentIds: string[]): Promise<Map<string, StatusChange[]>> {
  const byIncident = new Map<string, StatusChange[]>();
  if (incidentIds.length === 0) return byIncident;
  const rows = await db
    .select({ incidentId: incidentUpdates.incidentId, status: incidentUpdates.status, at: incidentUpdates.createdAt })
    .from(incidentUpdates)
    .where(inArray(incidentUpdates.incidentId, incidentIds))
    .orderBy(asc(incidentUpdates.createdAt));
  for (const row of rows) {
    if (!row.at) continue;
    const list = byIncident.get(row.incidentId) ?? [];
    list.push({ incidentId: row.incidentId, status: row.status, at: row.at });
    byIncident.set(row.incidentId, list);
  }
  return byIncident;
}

/** Adds `openIntervals` to each incident, for the status page uptime bars. */
export async function withOpenIntervals<T extends { id: string; createdAt: Date | null }>(incidents: T[]) {
  const changes = await loadStatusChanges(incidents.map((incident) => incident.id));
  return incidents.map((incident) => ({
    ...incident,
    openIntervals: incident.createdAt ? openIntervals(incident.createdAt, changes.get(incident.id) ?? []) : [],
  }));
}
