import { and, desc, eq, inArray } from "drizzle-orm";
import { tool } from "ai";
import { z } from "zod";

import { sreEvidenceItems } from "@/db/schema";
import { redactConnectorText } from "@/lib/sre/connectors";
import { db } from "@/utils/db";

const MAX_EVIDENCE_ITEMS = 25;
const MAX_TEXT_LENGTH = 1200;

const connectorSourceTypes = [
  "github",
  "kubernetes",
  "prometheus",
  "grafana",
  "datadog",
  "sentry",
  "loki",
  "elasticsearch",
  "splunk",
  "slack",
  "mcp",
  "webhook",
] as const;

const evidenceToolInputSchema = z.object({
  limit: z.number().int().min(1).max(MAX_EVIDENCE_ITEMS).optional().default(10),
  evidenceType: z.enum(["metric", "log", "trace", "artifact", "deployment", "event", "document", "topology"]).optional(),
});

export type SreEvidenceToolScope = {
  organizationId: string;
  projectId: string;
  incidentId: string;
};

export type StoredSreEvidenceQuery = SreEvidenceToolScope & {
  sourceMode: "native" | "connector";
  limit?: number;
  evidenceType?: string;
};

function truncateText(value: string | null | undefined, maxLength = MAX_TEXT_LENGTH) {
  if (!value) return null;
  const redacted = redactConnectorText(value);
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 3)}...` : redacted;
}

export async function listStoredSreEvidence(input: StoredSreEvidenceQuery) {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), MAX_EVIDENCE_ITEMS);
  const rows = await db
    .select({
      id: sreEvidenceItems.id,
      sourceType: sreEvidenceItems.sourceType,
      sourceUri: sreEvidenceItems.sourceUri,
      title: sreEvidenceItems.title,
      summary: sreEvidenceItems.summary,
      rawContentExcerpt: sreEvidenceItems.rawContentExcerpt,
      evidenceType: sreEvidenceItems.evidenceType,
      severity: sreEvidenceItems.severity,
      confidence: sreEvidenceItems.confidence,
      citationQuery: sreEvidenceItems.citationQuery,
      citationResultHash: sreEvidenceItems.citationResultHash,
      observedAt: sreEvidenceItems.observedAt,
      createdAt: sreEvidenceItems.createdAt,
    })
    .from(sreEvidenceItems)
    .where(
      and(
        eq(sreEvidenceItems.organizationId, input.organizationId),
        eq(sreEvidenceItems.projectId, input.projectId),
        eq(sreEvidenceItems.incidentId, input.incidentId),
        input.sourceMode === "native"
          ? eq(sreEvidenceItems.sourceType, "native")
          : inArray(sreEvidenceItems.sourceType, connectorSourceTypes),
        input.evidenceType ? eq(sreEvidenceItems.evidenceType, input.evidenceType as typeof sreEvidenceItems.evidenceType._.data) : undefined
      )
    )
    .orderBy(desc(sreEvidenceItems.observedAt), desc(sreEvidenceItems.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    sourceType: row.sourceType,
    sourceUri: truncateText(row.sourceUri, 1000),
    title: truncateText(row.title, 500) ?? "Untitled evidence",
    summary: truncateText(row.summary),
    rawContentExcerpt: truncateText(row.rawContentExcerpt),
    evidenceType: row.evidenceType,
    severity: row.severity,
    confidence: row.confidence,
    citationQuery: truncateText(row.citationQuery, 1000),
    citationResultHash: row.citationResultHash,
    observedAt: row.observedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export function createNativeEvidenceTool(scope: SreEvidenceToolScope) {
  return tool({
    description: "List stored native SuperCheck evidence for the scoped incident. Read-only; does not query external systems.",
    inputSchema: evidenceToolInputSchema,
    execute: async ({ limit, evidenceType }) => ({
      evidence: await listStoredSreEvidence({ ...scope, sourceMode: "native", limit, evidenceType }),
    }),
  });
}

export function createConnectorEvidenceTool(scope: SreEvidenceToolScope) {
  return tool({
    description: "List stored connector evidence for the scoped incident. Read-only; uses sanitized persisted summaries only.",
    inputSchema: evidenceToolInputSchema,
    execute: async ({ limit, evidenceType }) => ({
      evidence: await listStoredSreEvidence({ ...scope, sourceMode: "connector", limit, evidenceType }),
    }),
  });
}

export function createSreEvidenceTools(scope: SreEvidenceToolScope) {
  return {
    listNativeEvidence: createNativeEvidenceTool(scope),
    listConnectorEvidence: createConnectorEvidenceTool(scope),
  };
}
