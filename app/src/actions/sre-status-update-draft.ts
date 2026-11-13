"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { requireSreSubscription } from "@/app/api/sre/_auth";
import { sreIncidentTimelineEvents, sreIncidents, sreServices } from "@/db/schema";
import { createLogger } from "@/lib/logger/index";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { getDisplayStatus } from "@/lib/sre/incident-status-display";
import { getSourceRecoveredAt } from "@/lib/sre/incident-lifecycle";
import { checkSreStatusDraftRateLimit } from "@/lib/sre/sre-rate-limiter";
import { generateStatusUpdateDraft } from "@/lib/sre/status-update-draft";
import { db } from "@/utils/db";

import { permissionDeniedResult } from "@/lib/deletion/org-state";
const logger = createLogger({ module: "sre-status-update-draft" }) as { error: (data: unknown, message?: string) => void };

export type SreStatusDraftResult = { success: true; text: string } | { success: false; error: string };

/** Drafts a customer-safe status update. It is only text: a person edits it and posts it from the composer. */
export async function draftSreStatusUpdate(input: { incidentId: string }): Promise<SreStatusDraftResult> {
  try {
    const parsed = z.object({ incidentId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid incident" };
    const { userId, organizationId, orgPendingDeletion, project } = await requireProjectContext();
    if (!checkPermissionWithContext("sre_incident", "update", { userId, organizationId, orgPendingDeletion, project })) {
      return await permissionDeniedResult(organizationId, "Insufficient permissions to draft an update");
    }
    const [incident] = await db
      .select({
        id: sreIncidents.id,
        incidentNumber: sreIncidents.incidentNumber,
        title: sreIncidents.title,
        severity: sreIncidents.severity,
        status: sreIncidents.status,
        acknowledgedAt: sreIncidents.acknowledgedAt,
        serviceName: sreServices.name,
      })
      .from(sreIncidents)
      .leftJoin(sreServices, eq(sreServices.id, sreIncidents.primaryServiceId))
      .where(
        and(
          eq(sreIncidents.id, parsed.data.incidentId),
          eq(sreIncidents.organizationId, organizationId),
          eq(sreIncidents.projectId, project.id),
        ),
      )
      .limit(1);
    if (!incident) return { success: false, error: "Incident not found or access denied" };

    // Same gates as other AI drafts: a paid plan (no trial) and the per-user hourly limit.
    const gate = await requireSreSubscription(organizationId, { allowTrial: false });
    if (gate !== null) {
      const body = (await gate.json().catch(() => null)) as { error?: string } | null;
      return { success: false, error: body?.error ?? "AI drafts are not available for this organization" };
    }
    const limit = await checkSreStatusDraftRateLimit(userId, incident.id);
    if (!limit.allowed) return { success: false, error: "Too many drafts in a short time. Try again later." };

    const events = await db
      .select({ type: sreIncidentTimelineEvents.eventType, data: sreIncidentTimelineEvents.eventData })
      .from(sreIncidentTimelineEvents)
      .where(eq(sreIncidentTimelineEvents.incidentId, incident.id))
      .orderBy(desc(sreIncidentTimelineEvents.createdAt))
      .limit(30);
    const notes = events.flatMap((event) =>
      event.type === "comment" && typeof event.data?.text === "string" ? [event.data.text] : [],
    );
    // Same source of truth as the incident page, with no row limit.
    const recovered = (await getSourceRecoveredAt(incident.id)) !== null;

    const text = await generateStatusUpdateDraft(
      {
        incidentNumber: incident.incidentNumber,
        title: incident.title,
        severity: incident.severity,
        statusLabel: getDisplayStatus(incident.status, incident.acknowledgedAt).label,
        serviceName: incident.serviceName,
        recovered,
        notes,
      },
      organizationId,
    );
    return { success: true, text };
  } catch (error) {
    logger.error({ error }, "Error drafting SRE status update");
    return { success: false, error: "Could not draft an update. Write one by hand instead." };
  }
}
