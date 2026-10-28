"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  sreEvidenceItems,
  sreIncidentTimelineEvents,
  sreIncidents,
  sreInvestigationRuns,
  sreServices,
} from "@/db/schema";
import { requireSreSubscription } from "@/app/api/sre/_auth";
import { createLogger } from "@/lib/logger/index";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import {
  generatePostmortemDraft,
  postmortemSectionsSchema,
  toStoredPostmortem,
  type PostmortemContext,
} from "@/lib/sre/postmortem";
import { checkSrePostmortemRateLimit } from "@/lib/sre/sre-rate-limiter";
import { readStoredHypotheses } from "@/sre/lib/investigation-output";
import { db } from "@/utils/db";

const logger = createLogger({ module: "sre-postmortem" }) as {
  error: (data: unknown, message?: string) => void;
};

const generateSchema = z.object({ incidentId: z.string().uuid() });
const saveSchema = z.object({ incidentId: z.string().uuid(), sections: postmortemSectionsSchema });

export type SrePostmortemActionResult =
  | { success: true; postmortem: ReturnType<typeof toStoredPostmortem>; source?: "ai" | "template" }
  | { success: false; error: string };

function timelineLabel(eventType: string, data: Record<string, unknown> | null) {
  const pick = (...values: unknown[]) =>
    values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const text = pick(data?.text, data?.summary, data?.note, data?.message, data?.type);
  // Lifecycle events carry {state, comment}.
  const state = pick(data?.state);
  const body = state ? [state, pick(data?.comment, data?.summary)].filter(Boolean).join(" - ") : text ?? pick(data?.comment);
  const clipped = body ? body.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return clipped ? `${eventType.replace(/_/g, " ")}: ${clipped}` : eventType.replace(/_/g, " ");
}

async function guard() {
  const { userId, organizationId, project } = await requireProjectContext();
  const allowed = checkPermissionWithContext("sre_incident", "update", { userId, organizationId, project });
  return allowed ? { userId, organizationId, projectId: project.id } : null;
}

async function loadResolvedIncident(organizationId: string, projectId: string, incidentId: string) {
  const [incident] = await db
    .select({
      id: sreIncidents.id,
      incidentNumber: sreIncidents.incidentNumber,
      title: sreIncidents.title,
      severity: sreIncidents.severity,
      status: sreIncidents.status,
      createdAt: sreIncidents.createdAt,
      resolvedAt: sreIncidents.resolvedAt,
      resolutionSummary: sreIncidents.resolutionSummary,
      rootCauseSummary: sreIncidents.rootCauseSummary,
      confidenceScore: sreIncidents.confidenceScore,
      postmortem: sreIncidents.postmortem,
      serviceName: sreServices.name,
    })
    .from(sreIncidents)
    .leftJoin(sreServices, eq(sreServices.id, sreIncidents.primaryServiceId))
    .where(
      and(
        eq(sreIncidents.id, incidentId),
        eq(sreIncidents.organizationId, organizationId),
        eq(sreIncidents.projectId, projectId),
      ),
    )
    .limit(1);
  return incident ?? null;
}

/** Builds a draft from the timeline, resolution, hypotheses and evidence, and stores it. */
export async function generateSrePostmortem(
  input: z.input<typeof generateSchema>,
): Promise<SrePostmortemActionResult> {
  try {
    const parsed = generateSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid incident" };
    const auth = await guard();
    if (!auth) return { success: false, error: "Insufficient permissions to write a post-mortem" };

    const incident = await loadResolvedIncident(auth.organizationId, auth.projectId, parsed.data.incidentId);
    if (!incident) return { success: false, error: "Incident not found or access denied" };
    if (incident.status !== "resolved") return { success: false, error: "Resolve the incident before drafting a post-mortem" };

    const limit = await checkSrePostmortemRateLimit(auth.userId, incident.id);
    if (!limit.allowed) {
      return {
        success: false,
        error: limit.unavailable
          ? "Post-mortem drafts are temporarily unavailable. Try again shortly."
          : "Too many drafts in a short time. Try again later.",
      };
    }

    const timelineQuery = () =>
      db
        .select({ id: sreIncidentTimelineEvents.id, at: sreIncidentTimelineEvents.createdAt, eventType: sreIncidentTimelineEvents.eventType, data: sreIncidentTimelineEvents.eventData })
        .from(sreIncidentTimelineEvents)
        .where(eq(sreIncidentTimelineEvents.incidentId, incident.id));
    const [tail, head, evidence, [run]] = await Promise.all([
      // Newest 30 plus the first 10, so a long incident keeps both its start and its resolution.
      timelineQuery().orderBy(desc(sreIncidentTimelineEvents.createdAt)).limit(30),
      timelineQuery().orderBy(asc(sreIncidentTimelineEvents.createdAt)).limit(10),
      db
        .select({ id: sreEvidenceItems.id, title: sreEvidenceItems.title })
        .from(sreEvidenceItems)
        .where(
          and(
            eq(sreEvidenceItems.incidentId, incident.id),
            eq(sreEvidenceItems.organizationId, auth.organizationId),
            eq(sreEvidenceItems.projectId, auth.projectId),
          ),
        )
        .limit(15),
      db
        .select({ hypotheses: sreInvestigationRuns.hypotheses, snapshot: sreInvestigationRuns.agentStateSnapshot })
        .from(sreInvestigationRuns)
        .where(
          and(
            eq(sreInvestigationRuns.incidentId, incident.id),
            eq(sreInvestigationRuns.organizationId, auth.organizationId),
            eq(sreInvestigationRuns.projectId, auth.projectId),
            eq(sreInvestigationRuns.agentType, "investigation"),
            eq(sreInvestigationRuns.status, "completed"),
          ),
        )
        .orderBy(desc(sreInvestigationRuns.createdAt))
        .limit(1),
    ]);

    const structured = run?.snapshot && typeof run.snapshot === "object"
      ? (run.snapshot as { structured?: { nextChecks?: unknown; outcome?: string } | null }).structured
      : null;
    const score = incident.confidenceScore === null ? NaN : Number(incident.confidenceScore);
    const context: PostmortemContext = {
      incidentNumber: incident.incidentNumber,
      title: incident.title,
      severity: incident.severity,
      serviceName: incident.serviceName,
      createdAt: incident.createdAt,
      resolvedAt: incident.resolvedAt,
      resolutionSummary: incident.resolutionSummary,
      rootCauseSummary: incident.rootCauseSummary,
      confidenceLabel: !Number.isFinite(score) ? null : score >= 0.75 ? "High" : score >= 0.5 ? "Medium" : score > 0 ? "Low" : "Inconclusive",
      hypotheses: readStoredHypotheses(run?.hypotheses).map(({ title, state, rationale }) => ({ title, state, rationale })),
      nextChecks: Array.isArray(structured?.nextChecks)
        ? structured.nextChecks.filter((check): check is string => typeof check === "string").slice(0, 5)
        : [],
      evidence,
      timeline: [...new Map([...tail, ...head].map((event) => [event.id, event])).values()]
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .map((event) => ({ at: event.at, label: timelineLabel(event.eventType, event.data) })),
    };

    // Same usage gate as chat; when it is closed the template still works, with no model call.
    const gate = await requireSreSubscription(auth.organizationId, { allowTrial: false });
    const draft = await generatePostmortemDraft(context, { useAi: gate === null, organizationId: auth.organizationId });
    const postmortem = toStoredPostmortem(draft.sections, incident.postmortem, true);
    await db
      .update(sreIncidents)
      .set({ postmortem, updatedAt: new Date() })
      .where(
        and(
          eq(sreIncidents.id, incident.id),
          eq(sreIncidents.organizationId, auth.organizationId),
          eq(sreIncidents.projectId, auth.projectId),
        ),
      );
    revalidatePath(`/incidents/${incident.id}`);
    return { success: true, postmortem, source: draft.source };
  } catch (error) {
    logger.error({ error }, "Error generating SRE post-mortem");
    return { success: false, error: "Failed to generate post-mortem draft" };
  }
}

/** Saves edited sections. */
export async function saveSrePostmortem(
  input: z.input<typeof saveSchema>,
): Promise<SrePostmortemActionResult> {
  try {
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Each section must be 4000 characters or fewer" };
    const auth = await guard();
    if (!auth) return { success: false, error: "Insufficient permissions to edit a post-mortem" };

    const incident = await loadResolvedIncident(auth.organizationId, auth.projectId, parsed.data.incidentId);
    if (!incident) return { success: false, error: "Incident not found or access denied" };
    if (incident.status !== "resolved") return { success: false, error: "Post-mortems are available once the incident is resolved" };

    const postmortem = toStoredPostmortem(parsed.data.sections, incident.postmortem);
    await db
      .update(sreIncidents)
      .set({ postmortem, updatedAt: new Date() })
      .where(
        and(
          eq(sreIncidents.id, incident.id),
          eq(sreIncidents.organizationId, auth.organizationId),
          eq(sreIncidents.projectId, auth.projectId),
        ),
      );
    revalidatePath(`/incidents/${incident.id}`);
    return { success: true, postmortem };
  } catch (error) {
    logger.error({ error }, "Error saving SRE post-mortem");
    return { success: false, error: "Failed to save post-mortem" };
  }
}
