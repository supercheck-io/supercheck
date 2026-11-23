import type { incidents, incidentUpdates } from "@/db/schema";

type Incident = typeof incidents.$inferSelect;
type Update = typeof incidentUpdates.$inferSelect;

/** Incident columns a public status page may show; the query selects only these. */
export const PUBLIC_INCIDENT_COLUMNS = {
  id: true,
  name: true,
  status: true,
  impact: true,
  impactOverride: true,
  body: true,
  scheduledFor: true,
  scheduledUntil: true,
  shortlink: true,
  monitoringAt: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const PUBLIC_UPDATE_COLUMNS = { id: true, body: true, status: true, displayAt: true, createdAt: true } as const;

export type PublicIncidentFields = Pick<Incident, keyof typeof PUBLIC_INCIDENT_COLUMNS>;
type PublicUpdateFields = Pick<Update, keyof typeof PUBLIC_UPDATE_COLUMNS>;

/**
 * Copies only the public fields, so a full row (the in-app preview reads one) never carries the SRE link, author,
 * notify flags or metadata into a public page or its RSC payload.
 */
export function pickPublicIncident(row: PublicIncidentFields): PublicIncidentFields {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    impact: row.impact,
    impactOverride: row.impactOverride,
    body: row.body,
    scheduledFor: row.scheduledFor,
    scheduledUntil: row.scheduledUntil,
    shortlink: row.shortlink,
    monitoringAt: row.monitoringAt,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A public update; it shows from when it is displayed, which can differ from when it was written. */
export function toPublicUpdate(update: PublicUpdateFields) {
  return { id: update.id, body: update.body, status: update.status, displayAt: update.displayAt, createdAt: update.displayAt ?? update.createdAt };
}
