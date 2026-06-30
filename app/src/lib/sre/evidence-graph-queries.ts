import { and, desc, eq, isNull, or } from "drizzle-orm";

import {
  jobs,
  monitors,
  sreAlertEvents,
  sreContextPlaybooks,
  sreContextRecollections,
  sreEvidenceItems,
  sreIncidentAlerts,
  sreIncidents,
  sreInvestigationRecommendations,
  sreInvestigationRuns,
  sreServiceDeployments,
  sreServiceResources,
  sreServices,
} from "@/db/schema";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { db } from "@/utils/db";

export type SreEvidenceGraphNodeType =
  | "service"
  | "monitor"
  | "job"
  | "alert"
  | "incident"
  | "investigation"
  | "evidence"
  | "recommendation"
  | "deployment"
  | "commit"
  | "recollection"
  | "playbook";

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

function emptyStats(): Record<SreEvidenceGraphNodeType, number> {
  return {
    service: 0,
    monitor: 0,
    job: 0,
    alert: 0,
    incident: 0,
    investigation: 0,
    evidence: 0,
    recommendation: 0,
    deployment: 0,
    commit: 0,
    recollection: 0,
    playbook: 0,
  };
}

function truncateGraphTitle(value: string, maxLength = 140) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function formatSignatureValue(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .slice(0, 3)
      .map(String)
      .join(", ");
  }

  return null;
}

function getPlaybookMatchExplanation(alert: { severity: string; sourceType: string; fingerprintHash: string }, signature: Record<string, unknown>) {
  const preferredKeys = ["service", "serviceName", "source", "sourceType", "severity", "errorPattern", "metric", "status", "environment"];
  const factors = preferredKeys
    .flatMap((key) => {
      const formattedValue = formatSignatureValue(signature[key]);
      return formattedValue ? [`${key.replace(/([A-Z])/g, " $1").toLowerCase()}: ${formattedValue}`] : [];
    })
    .slice(0, 4);

  const fallbackFactors = [`source type: ${alert.sourceType}`, `severity: ${alert.severity}`];
  const explanationFactors = factors.length > 0 ? factors : fallbackFactors;

  return `Alert fingerprint matched promoted playbook signature (${explanationFactors.join("; ")}; hash ${alert.fingerprintHash.slice(0, 12)})`;
}

export async function getSreEvidenceGraph(): Promise<
  | { success: true; graph: SreEvidenceGraph }
  | { success: false; error: string; graph: SreEvidenceGraph }
> {
  const emptyGraph: SreEvidenceGraph = {
    nodes: [],
    edges: [],
    stats: emptyStats(),
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

    const [
      services,
      serviceResources,
      monitorRows,
      jobRows,
      deployments,
      alerts,
      incidentAlerts,
      incidents,
      investigations,
      evidenceItems,
      recommendations,
      recollections,
      playbooks,
    ] = await Promise.all([
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
          serviceId: sreServiceResources.serviceId,
          resourceType: sreServiceResources.resourceType,
          resourceId: sreServiceResources.resourceId,
          relationship: sreServiceResources.relationship,
          createdAt: sreServiceResources.createdAt,
        })
        .from(sreServiceResources)
        .innerJoin(sreServices, eq(sreServiceResources.serviceId, sreServices.id))
        .where(and(eq(sreServices.organizationId, organizationId), eq(sreServices.projectId, project.id)))
        .orderBy(desc(sreServiceResources.createdAt))
        .limit(200),
      db
        .select({
          id: monitors.id,
          name: monitors.name,
          type: monitors.type,
          status: monitors.status,
          target: monitors.target,
          createdAt: monitors.createdAt,
        })
        .from(monitors)
        .where(and(eq(monitors.organizationId, organizationId), eq(monitors.projectId, project.id)))
        .orderBy(desc(monitors.updatedAt))
        .limit(80),
      db
        .select({
          id: jobs.id,
          name: jobs.name,
          jobType: jobs.jobType,
          status: jobs.status,
          createdAt: jobs.createdAt,
        })
        .from(jobs)
        .where(and(eq(jobs.organizationId, organizationId), eq(jobs.projectId, project.id)))
        .orderBy(desc(jobs.updatedAt))
        .limit(80),
      db
        .select({
          id: sreServiceDeployments.id,
          serviceId: sreServiceDeployments.serviceId,
          deployedAt: sreServiceDeployments.deployedAt,
          deployedBy: sreServiceDeployments.deployedBy,
          commitSha: sreServiceDeployments.commitSha,
          commitMessage: sreServiceDeployments.commitMessage,
          prUrl: sreServiceDeployments.prUrl,
          source: sreServiceDeployments.source,
          sourceRef: sreServiceDeployments.sourceRef,
          createdAt: sreServiceDeployments.createdAt,
        })
        .from(sreServiceDeployments)
        .where(eq(sreServiceDeployments.projectId, project.id))
        .orderBy(desc(sreServiceDeployments.deployedAt))
        .limit(80),
      db
        .select({
          id: sreAlertEvents.id,
          title: sreAlertEvents.title,
          severity: sreAlertEvents.severity,
          status: sreAlertEvents.status,
          sourceType: sreAlertEvents.sourceType,
          sourceId: sreAlertEvents.sourceId,
          serviceId: sreAlertEvents.serviceId,
          fingerprintHash: sreAlertEvents.fingerprintHash,
          firedAt: sreAlertEvents.firedAt,
          createdAt: sreAlertEvents.createdAt,
        })
        .from(sreAlertEvents)
        .where(and(eq(sreAlertEvents.organizationId, organizationId), eq(sreAlertEvents.projectId, project.id)))
        .orderBy(desc(sreAlertEvents.firedAt))
        .limit(120),
      db
        .select({
          incidentId: sreIncidentAlerts.incidentId,
          alertEventId: sreIncidentAlerts.alertEventId,
          role: sreIncidentAlerts.role,
        })
        .from(sreIncidentAlerts)
        .innerJoin(sreIncidents, eq(sreIncidentAlerts.incidentId, sreIncidents.id))
        .where(and(eq(sreIncidents.organizationId, organizationId), eq(sreIncidents.projectId, project.id)))
        .limit(200),
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
      db
        .select({
          id: sreContextRecollections.id,
          incidentId: sreContextRecollections.incidentId,
          serviceId: sreContextRecollections.serviceId,
          rootCause: sreContextRecollections.rootCause,
          resolution: sreContextRecollections.resolution,
          promotedToPlaybookId: sreContextRecollections.promotedToPlaybookId,
          createdAt: sreContextRecollections.createdAt,
        })
        .from(sreContextRecollections)
        .where(and(eq(sreContextRecollections.organizationId, organizationId), eq(sreContextRecollections.projectId, project.id)))
        .orderBy(desc(sreContextRecollections.createdAt))
        .limit(80),
      db
        .select({
          id: sreContextPlaybooks.id,
          promotedFromRecollectionId: sreContextPlaybooks.promotedFromRecollectionId,
          name: sreContextPlaybooks.name,
          alertSignatureHash: sreContextPlaybooks.alertSignatureHash,
          alertSignature: sreContextPlaybooks.alertSignature,
          matchCount: sreContextPlaybooks.matchCount,
          status: sreContextPlaybooks.status,
          createdAt: sreContextPlaybooks.createdAt,
        })
        .from(sreContextPlaybooks)
        .where(
          and(
            eq(sreContextPlaybooks.organizationId, organizationId),
            or(eq(sreContextPlaybooks.projectId, project.id), isNull(sreContextPlaybooks.projectId))
          )
        )
        .orderBy(desc(sreContextPlaybooks.updatedAt))
        .limit(80),
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

    for (const monitor of monitorRows) {
      nodes.push({
        id: graphNodeId("monitor", monitor.id),
        sourceId: monitor.id,
        type: "monitor",
        title: monitor.name,
        subtitle: `${monitor.type} · ${monitor.target}`,
        status: monitor.status,
        href: "/monitors",
        createdAt: monitor.createdAt,
      });
    }

    for (const job of jobRows) {
      nodes.push({
        id: graphNodeId("job", job.id),
        sourceId: job.id,
        type: "job",
        title: job.name,
        subtitle: job.jobType,
        status: job.status,
        href: "/jobs",
        createdAt: job.createdAt,
      });
    }

    for (const resource of serviceResources) {
      if (resource.resourceType !== "monitor" && resource.resourceType !== "job") {
        continue;
      }

      addEdge(edges, {
        source: graphNodeId("service", resource.serviceId),
        target: graphNodeId(resource.resourceType, resource.resourceId),
        label: resource.relationship === "monitors" ? "monitored by" : resource.relationship.replace(/_/g, " "),
        evidence: "Service resource mapping",
      });
    }

    for (const deployment of deployments) {
      const deploymentNodeId = graphNodeId("deployment", deployment.id);
      nodes.push({
        id: deploymentNodeId,
        sourceId: deployment.id,
        type: "deployment",
        title: deployment.commitMessage ? truncateGraphTitle(deployment.commitMessage) : `${deployment.source} deployment`,
        subtitle: [deployment.deployedBy, deployment.sourceRef].filter(Boolean).join(" · ") || deployment.source,
        status: deployment.source,
        href: deployment.prUrl,
        createdAt: deployment.deployedAt ?? deployment.createdAt,
      });

      addEdge(edges, {
        source: graphNodeId("service", deployment.serviceId),
        target: deploymentNodeId,
        label: "deployed via",
        evidence: deployment.source,
      });

      if (deployment.commitSha) {
        const commitNodeId = graphNodeId("commit", deployment.commitSha);
        if (!nodes.some((node) => node.id === commitNodeId)) {
          nodes.push({
            id: commitNodeId,
            sourceId: deployment.commitSha,
            type: "commit",
            title: deployment.commitSha.slice(0, 12),
            subtitle: deployment.commitMessage ? truncateGraphTitle(deployment.commitMessage, 120) : "Deployment commit",
            status: deployment.source,
            href: deployment.prUrl,
            createdAt: deployment.deployedAt ?? deployment.createdAt,
          });
        }

        addEdge(edges, {
          source: deploymentNodeId,
          target: commitNodeId,
          label: "from commit",
          evidence: deployment.commitSha,
        });
      }
    }

    for (const alert of alerts) {
      const alertNodeId = graphNodeId("alert", alert.id);
      nodes.push({
        id: alertNodeId,
        sourceId: alert.id,
        type: "alert",
        title: alert.title,
        subtitle: alert.sourceType,
        status: `${alert.severity} · ${alert.status}`,
        href: null,
        createdAt: alert.firedAt ?? alert.createdAt,
      });

      if (alert.serviceId) {
        addEdge(edges, {
          source: graphNodeId("service", alert.serviceId),
          target: alertNodeId,
          label: "triggered alert",
          evidence: alert.sourceType,
        });
      }

      if (alert.sourceId && (alert.sourceType === "monitor" || alert.sourceType === "job")) {
        addEdge(edges, {
          source: graphNodeId(alert.sourceType, alert.sourceId),
          target: alertNodeId,
          label: "triggered",
          evidence: "Alert source id",
        });
      }
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

    for (const incidentAlert of incidentAlerts) {
      addEdge(edges, {
        source: graphNodeId("alert", incidentAlert.alertEventId),
        target: graphNodeId("incident", incidentAlert.incidentId),
        label: incidentAlert.role === "trigger" ? "triggered incident" : incidentAlert.role.replace(/_/g, " "),
        evidence: "Incident alert correlation",
      });
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
        href: investigation.incidentId ? `/incidents/${investigation.incidentId}` : "/copilot/investigations",
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

    for (const recollection of recollections) {
      const recollectionNodeId = graphNodeId("recollection", recollection.id);
      nodes.push({
        id: recollectionNodeId,
        sourceId: recollection.id,
        type: "recollection",
        title: truncateGraphTitle(recollection.rootCause ?? recollection.resolution ?? "Incident recollection"),
        subtitle: recollection.resolution ? truncateGraphTitle(recollection.resolution, 120) : "Resolved incident memory",
        status: recollection.promotedToPlaybookId ? "promoted" : "captured",
        href: recollection.incidentId ? `/incidents/${recollection.incidentId}` : null,
        createdAt: recollection.createdAt,
      });

      if (recollection.incidentId) {
        addEdge(edges, {
          source: graphNodeId("incident", recollection.incidentId),
          target: recollectionNodeId,
          label: "created memory",
          evidence: "Resolved incident recollection",
        });
      }

      if (recollection.serviceId) {
        addEdge(edges, {
          source: graphNodeId("service", recollection.serviceId),
          target: recollectionNodeId,
          label: "remembered for",
          evidence: "Recollection service scope",
        });
      }
    }

    for (const playbook of playbooks) {
      const playbookNodeId = graphNodeId("playbook", playbook.id);
      nodes.push({
        id: playbookNodeId,
        sourceId: playbook.id,
        type: "playbook",
        title: playbook.name,
        subtitle: `${playbook.matchCount} matches`,
        status: playbook.status,
        href: null,
        createdAt: playbook.createdAt,
      });

      if (playbook.promotedFromRecollectionId) {
        addEdge(edges, {
          source: graphNodeId("recollection", playbook.promotedFromRecollectionId),
          target: playbookNodeId,
          label: "promoted to",
          evidence: "Playbook promotion",
        });
      }

      for (const alert of alerts) {
        if (alert.fingerprintHash !== playbook.alertSignatureHash) {
          continue;
        }

        addEdge(edges, {
          source: graphNodeId("alert", alert.id),
          target: playbookNodeId,
          label: "matches playbook",
          evidence: getPlaybookMatchExplanation(alert, playbook.alertSignature),
        });
      }
    }

    const nodeIds = new Set(nodes.map((node) => node.id));
    const validEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    const stats = nodes.reduce<SreEvidenceGraph["stats"]>(
      (current, node) => ({ ...current, [node.type]: current[node.type] + 1 }),
      emptyStats()
    );

    return { success: true, graph: { nodes, edges: validEdges, stats } };
  } catch (error) {
    console.error("Error fetching SRE evidence graph:", error);
    return { success: false, error: "Failed to fetch SRE evidence graph", graph: emptyGraph };
  }
}
