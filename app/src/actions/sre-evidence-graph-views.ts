"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { sreEvidenceGraphFocusedViews, sreIncidents } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { db } from "@/utils/db";

const graphNodeTypeSchema = z.enum([
  "all",
  "service",
  "monitor",
  "job",
  "alert",
  "incident",
  "investigation",
  "evidence",
  "recommendation",
  "deployment",
  "commit",
  "recollection",
  "playbook",
]);

const focusedViewSchema = z.object({
  name: z.string().trim().min(1).max(160),
  query: z.string().trim().max(200).default(""),
  nodeType: graphNodeTypeSchema,
  incidentId: z.string().trim().max(80).default("all"),
});

const archiveFocusedViewSchema = z.object({
  id: z.string().uuid(),
});

export type SreEvidenceGraphFocusedViewItem = {
  id: string;
  name: string;
  query: string;
  nodeType: z.infer<typeof graphNodeTypeSchema>;
  incidentId: string;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

function canUseEvidenceGraph(input: { userId: string; organizationId: string; project: { id: string; userRole: string } }) {
  return ["sre_service", "sre_incident", "sre_investigation", "sre_evidence"].every((resource) =>
    checkPermissionWithContext(resource as "sre_service" | "sre_incident" | "sre_investigation" | "sre_evidence", "view", input)
  );
}

function canManageFocusedViews(input: { userId: string; organizationId: string; project: { id: string; userRole: string } }) {
  return checkPermissionWithContext("sre_investigation", "investigate", input);
}

function mapFocusedView(row: {
  id: string;
  name: string;
  query: string;
  nodeType: string;
  incidentNodeId: string;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SreEvidenceGraphFocusedViewItem {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    nodeType: graphNodeTypeSchema.parse(row.nodeType),
    incidentId: row.incidentNodeId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function validateIncidentFocus(incidentId: string, organizationId: string, projectId: string) {
  if (incidentId === "all") {
    return true;
  }

  const incidentParts = incidentId.split(":");
  const sourceId = incidentParts[1];
  const parsedSourceId = z.string().uuid().safeParse(sourceId);
  if (incidentParts.length !== 2 || incidentParts[0] !== "incident" || !parsedSourceId.success) {
    return false;
  }

  const incident = await db.query.sreIncidents.findFirst({
    where: and(
      eq(sreIncidents.id, parsedSourceId.data),
      eq(sreIncidents.organizationId, organizationId),
      eq(sreIncidents.projectId, projectId)
    ),
    columns: { id: true },
  });

  return Boolean(incident);
}

export async function listSreEvidenceGraphFocusedViews() {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    if (!canUseEvidenceGraph({ userId, organizationId, project })) {
      return { success: false as const, error: "Insufficient permissions to view shared evidence graph views", views: [] };
    }

    const rows = await db
      .select({
        id: sreEvidenceGraphFocusedViews.id,
        name: sreEvidenceGraphFocusedViews.name,
        query: sreEvidenceGraphFocusedViews.query,
        nodeType: sreEvidenceGraphFocusedViews.nodeType,
        incidentNodeId: sreEvidenceGraphFocusedViews.incidentNodeId,
        createdByUserId: sreEvidenceGraphFocusedViews.createdByUserId,
        createdAt: sreEvidenceGraphFocusedViews.createdAt,
        updatedAt: sreEvidenceGraphFocusedViews.updatedAt,
      })
      .from(sreEvidenceGraphFocusedViews)
      .where(
        and(
          eq(sreEvidenceGraphFocusedViews.organizationId, organizationId),
          eq(sreEvidenceGraphFocusedViews.projectId, project.id),
          eq(sreEvidenceGraphFocusedViews.visibility, "project"),
          eq(sreEvidenceGraphFocusedViews.status, "active")
        )
      )
      .orderBy(desc(sreEvidenceGraphFocusedViews.updatedAt))
      .limit(20);

    return { success: true as const, views: rows.map(mapFocusedView) };
  } catch (error) {
    console.error("Error listing SRE evidence graph focused views:", error);
    return { success: false as const, error: "Failed to load shared evidence graph views", views: [] };
  }
}

export async function saveSreEvidenceGraphFocusedView(input: z.input<typeof focusedViewSchema>) {
  const parsed = focusedViewSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Invalid evidence graph focused view" };
  }

  try {
    const { userId, organizationId, project } = await requireProjectContext();
    if (!canManageFocusedViews({ userId, organizationId, project })) {
      return { success: false as const, error: "Insufficient permissions to save shared evidence graph views" };
    }

    const isValidIncidentFocus = await validateIncidentFocus(parsed.data.incidentId, organizationId, project.id);
    if (!isValidIncidentFocus) {
      return { success: false as const, error: "Incident focus is not available in this project" };
    }

    const now = new Date();
    const [created] = await db
      .insert(sreEvidenceGraphFocusedViews)
      .values({
        organizationId,
        projectId: project.id,
        name: parsed.data.name,
        query: parsed.data.query,
        nodeType: parsed.data.nodeType,
        incidentNodeId: parsed.data.incidentId,
        visibility: "project",
        status: "active",
        viewData: {
          query: parsed.data.query,
          nodeType: parsed.data.nodeType,
          incidentId: parsed.data.incidentId,
        },
        createdByUserId: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({
        id: sreEvidenceGraphFocusedViews.id,
        name: sreEvidenceGraphFocusedViews.name,
        query: sreEvidenceGraphFocusedViews.query,
        nodeType: sreEvidenceGraphFocusedViews.nodeType,
        incidentNodeId: sreEvidenceGraphFocusedViews.incidentNodeId,
        createdByUserId: sreEvidenceGraphFocusedViews.createdByUserId,
        createdAt: sreEvidenceGraphFocusedViews.createdAt,
        updatedAt: sreEvidenceGraphFocusedViews.updatedAt,
      });

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_evidence_graph_focused_view_created",
      resource: "sre_evidence_graph_focused_view",
      resourceId: created.id,
      metadata: {
        projectId: project.id,
        nodeType: parsed.data.nodeType,
        incidentId: parsed.data.incidentId,
        hasQuery: parsed.data.query.length > 0,
      },
      success: true,
    });

    revalidatePath("/copilot/evidence-graph");
    return { success: true as const, view: mapFocusedView(created) };
  } catch (error) {
    console.error("Error saving SRE evidence graph focused view:", error);
    return { success: false as const, error: "Failed to save shared evidence graph view" };
  }
}

export async function archiveSreEvidenceGraphFocusedView(input: z.input<typeof archiveFocusedViewSchema>) {
  const parsed = archiveFocusedViewSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Invalid evidence graph focused view" };
  }

  try {
    const { userId, organizationId, project } = await requireProjectContext();
    if (!canManageFocusedViews({ userId, organizationId, project })) {
      return { success: false as const, error: "Insufficient permissions to archive shared evidence graph views" };
    }

    const [archived] = await db
      .update(sreEvidenceGraphFocusedViews)
      .set({ status: "archived", updatedAt: new Date() })
      .where(
        and(
          eq(sreEvidenceGraphFocusedViews.id, parsed.data.id),
          eq(sreEvidenceGraphFocusedViews.organizationId, organizationId),
          eq(sreEvidenceGraphFocusedViews.projectId, project.id),
          eq(sreEvidenceGraphFocusedViews.status, "active")
        )
      )
      .returning({ id: sreEvidenceGraphFocusedViews.id });

    if (!archived) {
      return { success: false as const, error: "Shared evidence graph view not found" };
    }

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_evidence_graph_focused_view_archived",
      resource: "sre_evidence_graph_focused_view",
      resourceId: archived.id,
      metadata: { projectId: project.id },
      success: true,
    });

    revalidatePath("/copilot/evidence-graph");
    return { success: true as const, archivedId: archived.id };
  } catch (error) {
    console.error("Error archiving SRE evidence graph focused view:", error);
    return { success: false as const, error: "Failed to archive shared evidence graph view" };
  }
}
