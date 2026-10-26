import { and, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";

import {
  sreAlertEvents,
  sreIncidentAlerts,
  sreIncidents,
  sreServices,
} from "@/db/schema";
import { db } from "@/utils/db";

export const SIMILAR_INCIDENT_WINDOW_DAYS = 180;
export const SIMILAR_INCIDENT_LIMIT = 5;
const CANDIDATE_LIMIT = 50;
const MAX_TOKENS = 6;
const MAX_TEXT = 300;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "has", "was", "are", "not", "failed",
  "failure", "error", "errors", "alert", "monitor", "check", "down", "high", "incident",
]);

export type SimilarIncidentMatch = "service" | "alert" | "title";

export type SimilarIncident = {
  id: string;
  incidentNumber: number;
  title: string;
  severity: string;
  serviceName: string | null;
  resolvedAt: Date | null;
  rootCauseSummary: string | null;
  resolutionSummary: string | null;
  matchedOn: SimilarIncidentMatch[];
  score: number;
};

export function tokenizeTitle(title: string): string[] {
  const tokens = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !STOPWORDS.has(token));
  return [...new Set(tokens)].slice(0, MAX_TOKENS);
}

type Candidate = Pick<SimilarIncident, "id" | "title" | "resolvedAt"> & {
  primaryServiceId: string | null;
};

/** Pure scoring so the ranking is testable without a database. */
export function scoreCandidate(
  candidate: Candidate,
  context: { serviceId: string | null; tokens: string[]; signatureIds: ReadonlySet<string> },
): { score: number; matchedOn: SimilarIncidentMatch[] } {
  const matchedOn: SimilarIncidentMatch[] = [];
  let score = 0;
  if (context.serviceId && candidate.primaryServiceId === context.serviceId) {
    matchedOn.push("service");
    score += 3;
  }
  if (context.signatureIds.has(candidate.id)) {
    matchedOn.push("alert");
    score += 3;
  }
  const candidateTokens = new Set(tokenizeTitle(candidate.title));
  const overlap = context.tokens.filter((token) => candidateTokens.has(token)).length;
  if (overlap > 0) {
    matchedOn.push("title");
    score += Math.min(overlap, 4);
  }
  return { score, matchedOn };
}

function clip(value: string | null, max = MAX_TEXT) {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

export type SimilarIncidentScope = {
  organizationId: string;
  projectId: string;
  incidentId: string;
};

/**
 * Resolved incidents in the same organization and project, from the last 180 days,
 * that share the primary service, an alert source/dedup key, or title tokens.
 * SQL only; no embeddings. Every query carries the tenancy predicates.
 */
export async function findSimilarIncidents(
  scope: SimilarIncidentScope,
  limit = SIMILAR_INCIDENT_LIMIT,
): Promise<SimilarIncident[]> {
  const tenant = (table: typeof sreIncidents) => and(
    eq(table.organizationId, scope.organizationId),
    eq(table.projectId, scope.projectId),
  );

  const [current] = await db
    .select({ title: sreIncidents.title, primaryServiceId: sreIncidents.primaryServiceId })
    .from(sreIncidents)
    .where(and(eq(sreIncidents.id, scope.incidentId), tenant(sreIncidents)))
    .limit(1);
  if (!current) return [];

  const alerts = await db
    .select({ sourceId: sreAlertEvents.sourceId, dedupKey: sreAlertEvents.dedupKey })
    .from(sreIncidentAlerts)
    .innerJoin(sreAlertEvents, eq(sreAlertEvents.id, sreIncidentAlerts.alertEventId))
    .where(
      and(
        eq(sreIncidentAlerts.incidentId, scope.incidentId),
        eq(sreAlertEvents.organizationId, scope.organizationId),
        eq(sreAlertEvents.projectId, scope.projectId),
      ),
    )
    .limit(20);
  const sourceIds = [...new Set(alerts.flatMap((alert) => (alert.sourceId ? [alert.sourceId] : [])))];
  const dedupKeys = [...new Set(alerts.flatMap((alert) => (alert.dedupKey ? [alert.dedupKey] : [])))];

  const since = new Date(Date.now() - SIMILAR_INCIDENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const signatureIds = new Set<string>();
  if (sourceIds.length > 0 || dedupKeys.length > 0) {
    const matches = await db
      .selectDistinct({ incidentId: sreIncidentAlerts.incidentId })
      .from(sreIncidentAlerts)
      .innerJoin(sreAlertEvents, eq(sreAlertEvents.id, sreIncidentAlerts.alertEventId))
      .innerJoin(sreIncidents, eq(sreIncidents.id, sreIncidentAlerts.incidentId))
      .where(
        and(
          tenant(sreIncidents),
          eq(sreAlertEvents.organizationId, scope.organizationId),
          eq(sreAlertEvents.projectId, scope.projectId),
          eq(sreIncidents.status, "resolved"),
          ne(sreIncidents.id, scope.incidentId),
          gte(sreIncidents.resolvedAt, since),
          or(
            sourceIds.length > 0 ? inArray(sreAlertEvents.sourceId, sourceIds) : undefined,
            dedupKeys.length > 0 ? inArray(sreAlertEvents.dedupKey, dedupKeys) : undefined,
          ),
        ),
      )
      .limit(CANDIDATE_LIMIT);
    for (const match of matches) signatureIds.add(match.incidentId);
  }

  const tokens = tokenizeTitle(current.title);
  const titleClauses = tokens.map((token) => sql`${sreIncidents.title} ILIKE ${`%${token}%`}`);
  const matchers = [
    current.primaryServiceId ? eq(sreIncidents.primaryServiceId, current.primaryServiceId) : undefined,
    signatureIds.size > 0 ? inArray(sreIncidents.id, [...signatureIds]) : undefined,
    ...titleClauses,
  ].filter(Boolean);
  if (matchers.length === 0) return [];

  const rows = await db
    .select({
      id: sreIncidents.id,
      incidentNumber: sreIncidents.incidentNumber,
      title: sreIncidents.title,
      severity: sreIncidents.severity,
      primaryServiceId: sreIncidents.primaryServiceId,
      serviceName: sreServices.name,
      resolvedAt: sreIncidents.resolvedAt,
      rootCauseSummary: sreIncidents.rootCauseSummary,
      resolutionSummary: sreIncidents.resolutionSummary,
    })
    .from(sreIncidents)
    .leftJoin(sreServices, eq(sreServices.id, sreIncidents.primaryServiceId))
    .where(
      and(
        tenant(sreIncidents),
        eq(sreIncidents.status, "resolved"),
        ne(sreIncidents.id, scope.incidentId),
        gte(sreIncidents.resolvedAt, since),
        or(...matchers),
      ),
    )
    .orderBy(desc(sreIncidents.resolvedAt))
    .limit(CANDIDATE_LIMIT);

  return rows
    .map((row) => {
      const { score, matchedOn } = scoreCandidate(row, {
        serviceId: current.primaryServiceId,
        tokens,
        signatureIds,
      });
      return {
        id: row.id,
        incidentNumber: row.incidentNumber,
        title: row.title,
        severity: row.severity,
        serviceName: row.serviceName,
        resolvedAt: row.resolvedAt,
        rootCauseSummary: clip(row.rootCauseSummary),
        resolutionSummary: clip(row.resolutionSummary),
        matchedOn,
        score,
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0))
    .slice(0, limit);
}

/** Lines for the fenced "past incidents" prompt block. */
export function similarIncidentPromptLines(incidents: SimilarIncident[]): string[] {
  return incidents.map((incident) =>
    [
      `#${incident.incidentNumber} "${incident.title}"`,
      incident.serviceName ? `service=${incident.serviceName}` : null,
      `matched=${incident.matchedOn.join("+")}`,
      incident.rootCauseSummary ? `root cause: ${incident.rootCauseSummary}` : null,
      incident.resolutionSummary ? `resolution: ${incident.resolutionSummary}` : null,
    ]
      .filter(Boolean)
      .join("; "),
  );
}
