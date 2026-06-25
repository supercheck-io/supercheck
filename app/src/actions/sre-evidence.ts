"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  externalConnectors,
  privateAgentJobs,
  sreEvidenceItems,
  sreIncidents,
  sreIncidentTimelineEvents,
  sreInvestigationRuns,
} from "@/db/schema";
import { getActualModelName } from "@/lib/ai/ai-provider";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { normalizePrivateAgentEvidenceSummaries } from "@/lib/sre/connector-job-evidence";
import { generateEvidenceBrief } from "@/lib/sre/evidence-brief-generator";
import { collectNativeEvidence, type NativeEvidenceWindow } from "@/lib/sre/native-evidence-collector";
import { checkSreEvidenceBriefRateLimit } from "@/lib/sre/sre-rate-limiter";
import { db } from "@/utils/db";

const generateBriefSchema = z.object({
  incidentId: z.string().uuid(),
});

export type GenerateSreEvidenceBriefResult =
  | {
      success: true;
      message: string;
      brief: {
        suspectedFailureDomain: string;
        summary: string;
        confidenceScore: number;
        citedEvidenceIds: string[];
        provider: "ai" | "fallback";
      };
      evidenceCount: number;
    }
  | { success: false; error: string };

const connectorEvidenceSourceTypes = [
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
type ConnectorEvidenceSourceType = (typeof connectorEvidenceSourceTypes)[number];
const connectorEvidenceSourceTypeSet = new Set<string>(connectorEvidenceSourceTypes);

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function connectorSourceType(value: string) {
  return connectorEvidenceSourceTypeSet.has(value) ? value as ConnectorEvidenceSourceType : null;
}

function jobSpecServiceId(jobSpec: Record<string, unknown>) {
  return typeof jobSpec.serviceId === "string" ? jobSpec.serviceId : null;
}

async function importCompletedPrivateAgentConnectorEvidence(input: {
  organizationId: string;
  projectId: string;
  incidentId: string;
  serviceId: string | null;
  investigationRunId: string;
  window: NativeEvidenceWindow;
}) {
  if (!input.serviceId) {
    return [];
  }

  const completedJobs = await db
    .select({ job: privateAgentJobs, connector: externalConnectors })
    .from(privateAgentJobs)
    .innerJoin(externalConnectors, eq(privateAgentJobs.connectorId, externalConnectors.id))
    .where(
      and(
        eq(privateAgentJobs.organizationId, input.organizationId),
        eq(privateAgentJobs.projectId, input.projectId),
        eq(privateAgentJobs.jobClass, "sre_connector_query"),
        eq(privateAgentJobs.status, "completed"),
        eq(externalConnectors.organizationId, input.organizationId),
        eq(externalConnectors.projectId, input.projectId)
      )
    )
    .orderBy(desc(privateAgentJobs.completedAt), desc(privateAgentJobs.createdAt))
    .limit(25);

  const matchingJobs = completedJobs.filter(({ job }) => jobSpecServiceId(job.jobSpec) === input.serviceId);

  if (matchingJobs.length === 0) {
    return [];
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.incidentId}))`);
    const imported = [];

    for (const { job, connector } of matchingJobs) {
      const sourceType = connectorSourceType(connector.type);
      if (!sourceType) {
        continue;
      }

      const summaries = normalizePrivateAgentEvidenceSummaries(job.resultSummary, 25);
      for (const item of summaries) {
        if (item.observedAtDate < input.window.since || item.observedAtDate > input.window.until) {
          continue;
        }

        const [existing] = await tx
          .select()
          .from(sreEvidenceItems)
          .where(
            and(
              eq(sreEvidenceItems.incidentId, input.incidentId),
              eq(sreEvidenceItems.citationResultHash, item.resultHash)
            )
          )
          .limit(1);

        if (existing) {
          imported.push(existing);
          continue;
        }

        const [created] = await tx
          .insert(sreEvidenceItems)
          .values({
            organizationId: input.organizationId,
            projectId: input.projectId,
            incidentId: input.incidentId,
            investigationRunId: input.investigationRunId,
            sourceType,
            sourceConnectorId: connector.id,
            sourceUri: item.sourceUri,
            title: item.title,
            summary: item.summary,
            rawContentExcerpt: truncate(item.summary, 1800),
            evidenceType: item.evidenceType,
            severity: null,
            confidence: "0.8000",
            tags: { source: "private_agent_connector", connectorType: connector.type },
            metadata: {
              privateAgentJobId: job.id,
              privateAgentId: job.privateAgentId,
              connectorEvidenceId: item.id,
              connectorName: connector.name,
              jobSpecHash: job.jobSpecHash,
              resultHash: item.resultHash,
              importedAt: new Date().toISOString(),
            },
            citationQuery: `private_agent_jobs.id = ${job.id}; evidence.id = ${item.id}`,
            citationResultHash: item.resultHash,
            observedAt: item.observedAtDate,
            createdAt: new Date(),
          })
          .returning();

        imported.push(created);
      }
    }

    return imported;
  });
}

export async function generateSreEvidenceBrief(input: {
  incidentId: string;
}): Promise<GenerateSreEvidenceBriefResult> {
  const startedAt = Date.now();

  try {
    const parsed = generateBriefSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid incident ID" };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canInvestigate = checkPermissionWithContext("sre_incident", "investigate", {
      userId,
      organizationId,
      project,
    });

    if (!canInvestigate) {
      return { success: false, error: "Insufficient permissions to investigate this incident" };
    }

    const rateLimit = await checkSreEvidenceBriefRateLimit(userId, parsed.data.incidentId);
    if (!rateLimit.allowed) {
      return { success: false, error: "Evidence brief generation rate limit reached. Wait a moment and try again." };
    }

    const collection = await collectNativeEvidence({
      organizationId,
      projectId: project.id,
      incidentId: parsed.data.incidentId,
    });

    if (!collection) {
      return { success: false, error: "Incident not found or access denied" };
    }

    const modelId = getActualModelName();
    const [run] = await db
      .insert(sreInvestigationRuns)
      .values({
        organizationId,
        projectId: project.id,
        incidentId: parsed.data.incidentId,
        agentType: "sre_ai",
        status: "running",
        modelId,
        promptInput: {
          mode: "native_evidence_brief",
          evidenceWindow: {
            since: collection.window.since.toISOString(),
            until: collection.window.until.toISOString(),
            source: collection.window.source,
            confidence: collection.window.confidence,
          },
          candidateEvidenceCount: collection.evidence.length,
        },
        createdByUserId: userId,
        startedAt: new Date(startedAt),
        createdAt: new Date(),
      })
      .returning();

    const evidenceRows = [];

    for (const item of collection.evidence) {
      const [existing] = await db
        .select()
        .from(sreEvidenceItems)
        .where(
          and(
            eq(sreEvidenceItems.incidentId, parsed.data.incidentId),
            eq(sreEvidenceItems.citationResultHash, item.citationResultHash)
          )
        )
        .limit(1);

      if (existing) {
        evidenceRows.push(existing);
        continue;
      }

      const [created] = await db
        .insert(sreEvidenceItems)
        .values({
          organizationId,
          projectId: project.id,
          incidentId: parsed.data.incidentId,
          investigationRunId: run.id,
          sourceType: "native",
          sourceUri: item.sourceUri,
          title: item.title,
          summary: item.summary,
          rawContentExcerpt: item.rawContentExcerpt,
          evidenceType: item.evidenceType,
          severity: item.severity,
          confidence: String(item.confidence),
          tags: item.tags,
          metadata: item.metadata,
          citationQuery: item.citationQuery,
          citationResultHash: item.citationResultHash,
          observedAt: item.observedAt,
          createdAt: new Date(),
        })
        .returning();

      evidenceRows.push(created);
    }

    const connectorEvidenceRows = await importCompletedPrivateAgentConnectorEvidence({
      organizationId,
      projectId: project.id,
      incidentId: parsed.data.incidentId,
      serviceId: collection.incident.primaryServiceId,
      investigationRunId: run.id,
      window: collection.window,
    });
    const allEvidenceRows = [...evidenceRows, ...connectorEvidenceRows];

    const brief = await generateEvidenceBrief({
      incidentTitle: collection.incident.title,
      incidentSeverity: collection.incident.severity,
      userId,
      organizationId,
      evidence: allEvidenceRows.map((item) => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        evidenceType: item.evidenceType,
        severity: item.severity,
        confidence: item.confidence,
        sourceUri: item.sourceUri,
        rawContentExcerpt: item.rawContentExcerpt,
        observedAt: item.observedAt,
      })),
    });

    await db
      .update(sreInvestigationRuns)
      .set({
        status: "completed",
        modelId: brief.modelId,
        confidenceScore: String(brief.confidenceScore),
        rootCauseHypothesis: brief.suspectedFailureDomain,
        agentStateSnapshot: {
          provider: brief.provider,
          summary: brief.summary,
          citedEvidenceIds: brief.citedEvidenceIds,
          evidenceCount: allEvidenceRows.length,
          connectorEvidenceCount: connectorEvidenceRows.length,
        },
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      })
      .where(and(
        eq(sreInvestigationRuns.id, run.id),
        eq(sreInvestigationRuns.organizationId, organizationId),
        eq(sreInvestigationRuns.projectId, project.id)
      ));

    await db
      .update(sreIncidents)
      .set({
        ...(collection.incident.status === "triggered" ? { status: "investigating" as const } : {}),
        rootCauseSummary: brief.summary,
        confidenceScore: String(brief.confidenceScore),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sreIncidents.id, parsed.data.incidentId),
          eq(sreIncidents.organizationId, organizationId),
          eq(sreIncidents.projectId, project.id)
        )
      );

    await db.insert(sreIncidentTimelineEvents).values({
      incidentId: parsed.data.incidentId,
      eventType: "ai_finding",
      eventData: {
        type: "native_evidence_brief",
        provider: brief.provider,
        suspectedFailureDomain: brief.suspectedFailureDomain,
        confidenceScore: brief.confidenceScore,
        citedEvidenceIds: brief.citedEvidenceIds,
        evidenceCount: allEvidenceRows.length,
        connectorEvidenceCount: connectorEvidenceRows.length,
      },
      actorType: "agent",
      agentRunId: run.id,
      createdAt: new Date(),
    });

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_native_evidence_brief_generated",
      resource: "sre_incident",
      resourceId: parsed.data.incidentId,
      metadata: {
        projectId: project.id,
        investigationRunId: run.id,
        evidenceCount: allEvidenceRows.length,
        connectorEvidenceCount: connectorEvidenceRows.length,
        provider: brief.provider,
      },
      success: true,
    });

    revalidatePath("/incidents");
    revalidatePath(`/incidents/${parsed.data.incidentId}`);

    return {
      success: true,
      message: brief.provider === "ai" ? "Native evidence brief generated" : "Native evidence gathered with fallback brief",
      brief: {
        suspectedFailureDomain: brief.suspectedFailureDomain,
        summary: brief.summary,
        confidenceScore: brief.confidenceScore,
        citedEvidenceIds: brief.citedEvidenceIds,
        provider: brief.provider,
      },
      evidenceCount: allEvidenceRows.length,
    };
  } catch (error) {
    console.error("Error generating SRE evidence brief:", error);
    return { success: false, error: "Failed to generate native evidence brief" };
  }
}
