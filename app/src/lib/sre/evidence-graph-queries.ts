import { and, desc, eq } from "drizzle-orm";

import { sreEvidenceItems, sreIncidents, sreInvestigationRecommendations, sreInvestigationRuns, sreServices } from "@/db/schema";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { db } from "@/utils/db";

export type SreEvidenceGraphNodeType = "service" | "incident" | "investigation" | "evidence" | "recommendation";

export type SreEvidenceGraphNode = {
  id: string;
  sourceId: string;
  type: SreEvidenceGraphNodeType;
  title: string;
  subtitle: string | null;
  status: string | null;
  href: string | null;
  createdAt: Date | null;
};

export type SreEvidenceGraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  evidence: string | null;
};

export type SreEvidenceGraph = {
  nodes: SreEvidenceGraphNode[];
  edges: SreEvidenceGraphEdge[];
  stats: Record<SreEvidenceGraphNodeType, number>;
};

function graphNodeId(type: SreEvidenceGraphNodeType, sourceId: string) {
  return `${type}:${sourceId}`;
}

function addEdge(edges: SreEvidenceGraphEdge[], edge: Omit<SreEvidenceGraphEdge, "id">) {
  const id = `${edge.source}->${edge.target}:${edge.label}`;
  if (edges.some((existing) => existing.id === id)) {
    return;
  }

  edges.push({ id, ...edge });
}

export async function getSreEvidenceGraph(): Promise<
  | { success: true; graph: SreEvidenceGraph }
  | { success: false; error: string; graph: SreEvidenceGraph }
> {
  const emptyGraph: SreEvidenceGraph = {
    nodes: [],
    edges: [],
    stats: { service: 0, incident: 0, investigation: 0, evidence: 0, recommendation: 0 },
  };

  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canViewGraph = ["sre_service", "sre_incident", "sre_investigation", "sre_evidence"].every((resource) =>
      checkPermissionWithContext(resource as "sre_service" | "sre_incident" | "sre_investigation" | "sre_evidence", "view", {
        userId,
        organizationId,
        project,
      })
    );

    if (!canViewGraph) {
      return { success: false, error: "Insufficient permissions to view the SRE evidence graph", graph: emptyGraph };
    }

    const [services, incidents, investigations, evidenceItems, recommendations] = await Promise.all([
      db
        .select({
          id: sreServices.id,
          name: sreServices.name,
          environment: sreServices.environment,
          tier: sreServices.tier,
          status: sreServices.status,
          createdAt: sreServices.createdAt,
        })
        .from(sreServices)
        .where(and(eq(sreServices.organizationId, organizationId), eq(sreServices.projectId, project.id)))
        .orderBy(desc(sreServices.updatedAt))
        .limit(50),
      db
        .select({
          id: sreIncidents.id,
          incidentNumber: sreIncidents.incidentNumber,
          title: sreIncidents.title,
          severity: sreIncidents.severity,
          status: sreIncidents.status,
          primaryServiceId: sreIncidents.primaryServiceId,
          createdAt: sreIncidents.createdAt,
        })
        .from(sreIncidents)
        .where(and(eq(sreIncidents.organizationId, organizationId), eq(sreIncidents.projectId, project.id)))
        .orderBy(desc(sreIncidents.createdAt))
        .limit(60),
      db
        .select({
          id: sreInvestigationRuns.id,
          incidentId: sreInvestigationRuns.incidentId,
          status: sreInvestigationRuns.status,
          agentType: sreInvestigationRuns.agentType,
          modelId: sreInvestigationRuns.modelId,
          rootCauseHypothesis: sreInvestigationRuns.rootCauseHypothesis,
          createdAt: sreInvestigationRuns.createdAt,
        })
        .from(sreInvestigationRuns)
        .where(and(eq(sreInvestigationRuns.organizationId, organizationId), eq(sreInvestigationRuns.projectId, project.id)))
        .orderBy(desc(sreInvestigationRuns.createdAt))
        .limit(100),
      db
        .select({
          id: sreEvidenceItems.id,
          incidentId: sreEvidenceItems.incidentId,
          investigationRunId: sreEvidenceItems.investigationRunId,
          title: sreEvidenceItems.title,
          sourceType: sreEvidenceItems.sourceType,
          evidenceType: sreEvidenceItems.evidenceType,
          severity: sreEvidenceItems.severity,
          createdAt: sreEvidenceItems.createdAt,
        })
        .from(sreEvidenceItems)
        .where(and(eq(sreEvidenceItems.organizationId, organizationId), eq(sreEvidenceItems.projectId, project.id)))
        .orderBy(desc(sreEvidenceItems.createdAt))
        .limit(150),
      db
        .select({
          id: sreInvestigationRecommendations.id,
          incidentId: sreInvestigationRecommendations.incidentId,
          investigationRunId: sreInvestigationRecommendations.investigationRunId,
          applicationStatus: sreInvestigationRecommendations.applicationStatus,
          recommendationText: sreInvestigationRecommendations.recommendationText,
          createdAt: sreInvestigationRecommendations.createdAt,
        })
        .from(sreInvestigationRecommendations)
        .innerJoin(sreInvestigationRuns, eq(sreInvestigationRecommendations.investigationRunId, sreInvestigationRuns.id))
        .where(and(eq(sreInvestigationRuns.organizationId, organizationId), eq(sreInvestigationRuns.projectId, project.id)))
        .orderBy(desc(sreInvestigationRecommendations.createdAt))
        .limit(100),
    ]);

    const nodes: SreEvidenceGraphNode[] = [];
    const edges: SreEvidenceGraphEdge[] = [];

    for (const service of services) {
      nodes.push({
        id: graphNodeId("service", service.id),
        sourceId: service.id,
        type: "service",
        title: service.name,
        subtitle: [service.environment, `tier ${service.tier}`].filter(Boolean).join(" · "),
        status: service.status,
        href: "/services",
        createdAt: service.createdAt,
      });
    }

    for (const incident of incidents) {
      const incidentNodeId = graphNodeId("incident", incident.id);
      nodes.push({
        id: incidentNodeId,
        sourceId: incident.id,
        type: "incident",
        title: `#${incident.incidentNumber} ${incident.title}`,
        subtitle: incident.severity,
        status: incident.status,
        href: `/incidents/${incident.id}`,
        createdAt: incident.createdAt,
      });

      if (incident.primaryServiceId) {
        addEdge(edges, {
          source: graphNodeId("service", incident.primaryServiceId),
          target: incidentNodeId,
          label: "impacted service",
          evidence: "Incident primary service scope",
        });
      }
    }

    for (const investigation of investigations) {
      const investigationNodeId = graphNodeId("investigation", investigation.id);
      nodes.push({
        id: investigationNodeId,
        sourceId: investigation.id,
        type: "investigation",
        title: investigation.rootCauseHypothesis ?? `${investigation.agentType} investigation`,
        subtitle: investigation.modelId,
        status: investigation.status,
        href: investigation.incidentId ? `/incidents/${investigation.incidentId}` : "/sre-ai/investigations",
        createdAt: investigation.createdAt,
      });

      if (investigation.incidentId) {
        addEdge(edges, {
          source: graphNodeId("incident", investigation.incidentId),
          target: investigationNodeId,
          label: "investigated by",
          evidence: "Investigation run incident scope",
        });
      }
    }

    for (const evidence of evidenceItems) {
      const evidenceNodeId = graphNodeId("evidence", evidence.id);
      nodes.push({
        id: evidenceNodeId,
        sourceId: evidence.id,
        type: "evidence",
        title: evidence.title,
        subtitle: `${evidence.sourceType} · ${evidence.evidenceType}`,
        status: evidence.severity,
        href: evidence.incidentId ? `/incidents/${evidence.incidentId}#sre-evidence-${evidence.id}` : null,
        createdAt: evidence.createdAt,
      });

      if (evidence.incidentId) {
        addEdge(edges, {
          source: graphNodeId("incident", evidence.incidentId),
          target: evidenceNodeId,
          label: "has evidence",
          evidence: evidence.sourceType,
        });
      }

      if (evidence.investigationRunId) {
        addEdge(edges, {
          source: graphNodeId("investigation", evidence.investigationRunId),
          target: evidenceNodeId,
          label: "collected",
          evidence: evidence.evidenceType,
        });
      }
    }

    for (const recommendation of recommendations) {
      const recommendationNodeId = graphNodeId("recommendation", recommendation.id);
      nodes.push({
        id: recommendationNodeId,
        sourceId: recommendation.id,
        type: "recommendation",
        title: recommendation.recommendationText,
        subtitle: "Recommended fix step",
        status: recommendation.applicationStatus,
        href: `/incidents/${recommendation.incidentId}`,
        createdAt: recommendation.createdAt,
      });

      addEdge(edges, {
        source: graphNodeId("investigation", recommendation.investigationRunId),
        target: recommendationNodeId,
        label: "recommended",
        evidence: "AI recommendation",
      });
    }

    const nodeIds = new Set(nodes.map((node) => node.id));
    const validEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    const stats = nodes.reduce<SreEvidenceGraph["stats"]>(
      (current, node) => ({ ...current, [node.type]: current[node.type] + 1 }),
      { service: 0, incident: 0, investigation: 0, evidence: 0, recommendation: 0 }
    );

    return { success: true, graph: { nodes, edges: validEdges, stats } };
  } catch (error) {
    console.error("Error fetching SRE evidence graph:", error);
    return { success: false, error: "Failed to fetch SRE evidence graph", graph: emptyGraph };
  }
}
