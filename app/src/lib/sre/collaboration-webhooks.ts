import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { sreIncidents, sreIncidentTimelineEvents, webhookIdempotency } from "@/db/schema";
import { assertCanStartSreInvestigation, consumeSreInvestigationCredit, SreInvestigationBillingError } from "@/lib/sre/investigation-billing";
import { postSreInvestigationSlackSummary } from "@/lib/sre/slack-outbound";
import { startSreIncidentInvestigation, executeSreIncidentInvestigation } from "@/sre/lib/investigation-runner";
import { db } from "@/utils/db";

const WEBHOOK_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const MAX_PROVIDER_TEXT_LENGTH = 2000;

const collaborationMessageSchema = z.object({
  provider: z.enum(["slack", "teams"]),
  deliveryId: z.string().trim().min(1).max(300),
  text: z.string().max(10_000),
  incidentId: z.string().uuid().optional().nullable(),
  channelId: z.string().trim().max(200).optional().nullable(),
  threadTs: z.string().trim().max(200).optional().nullable(),
  responderId: z.string().trim().max(200).optional().nullable(),
  responderName: z.string().trim().max(200).optional().nullable(),
});

export type SreCollaborationCommand = "acknowledge" | "resolve" | "investigate";

export function extractSreIncidentIdFromText(text: string) {
  return text.match(UUID_PATTERN)?.[0] ?? null;
}

export function sanitizeCollaborationText(text: string) {
  return text
    .replace(/<@[^>]+>/g, "")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROVIDER_TEXT_LENGTH);
}

export function detectSreCollaborationCommand(text: string): SreCollaborationCommand {
  const normalized = text.toLowerCase();
  if (/\b(resolve|resolved|mark resolved|close incident)\b/.test(normalized)) {
    return "resolve";
  }

  if (/\b(ack|acknowledge|acknowledged|investigating)\b/.test(normalized)) {
    return "acknowledge";
  }

  return "investigate";
}

function isResponderAllowed(responderId: string | null | undefined) {
  const allowUnmappedResponders = process.env.SRE_COLLABORATION_ALLOW_UNMAPPED_RESPONDERS === "true";
  if (allowUnmappedResponders) {
    return true;
  }

  const allowedIds = (process.env.SRE_COLLABORATION_ALLOWED_RESPONDER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return Boolean(responderId && allowedIds.includes(responderId));
}

export async function claimSreCollaborationWebhook(deliveryId: string, eventType: string) {
  const result = await db
    .insert(webhookIdempotency)
    .values({
      webhookId: deliveryId,
      eventType,
      resultStatus: null,
      expiresAt: new Date(Date.now() + WEBHOOK_IDEMPOTENCY_TTL_MS),
    })
    .onConflictDoNothing({
      target: [webhookIdempotency.webhookId, webhookIdempotency.eventType],
    })
    .returning({ id: webhookIdempotency.id });

  return result.length > 0;
}

export async function updateSreCollaborationWebhookResult(input: {
  deliveryId: string;
  eventType: string;
  status: "success" | "error" | "skipped";
  message?: string;
}) {
  await db
    .update(webhookIdempotency)
    .set({
      resultStatus: input.status,
      resultMessage: input.message?.slice(0, 500) ?? null,
    })
    .where(
      and(
        eq(webhookIdempotency.webhookId, input.deliveryId),
        eq(webhookIdempotency.eventType, input.eventType)
      )
    );
}

function getIncidentDeepLink(incidentId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";
  return `${baseUrl.replace(/\/$/, "")}/incidents/${incidentId}`;
}

async function recordCollaborationTimelineEvent(input: {
  incidentId: string;
  provider: "slack" | "teams";
  command: SreCollaborationCommand;
  text: string;
  channelId?: string | null;
  threadTs?: string | null;
  responderId?: string | null;
  responderName?: string | null;
}) {
  await db.insert(sreIncidentTimelineEvents).values({
    incidentId: input.incidentId,
    eventType: "comment",
    actorType: "system",
    eventData: {
      type: "sre_collaboration_message",
      provider: input.provider,
      command: input.command,
      text: input.text,
      channelId: input.channelId ?? null,
      threadTs: input.threadTs ?? null,
      responderId: input.responderId ?? null,
      responderName: input.responderName ?? null,
    },
    createdAt: new Date(),
  });
}

export async function processSreCollaborationMessage(input: z.input<typeof collaborationMessageSchema>) {
  const parsed = collaborationMessageSchema.parse(input);
  const text = sanitizeCollaborationText(parsed.text);
  const incidentId = parsed.incidentId ?? extractSreIncidentIdFromText(text);

  if (!incidentId) {
    return { status: "skipped" as const, reason: "missing_incident_id" };
  }

  const incident = await db.query.sreIncidents.findFirst({
    where: eq(sreIncidents.id, incidentId),
    columns: {
      id: true,
      organizationId: true,
      projectId: true,
      title: true,
      status: true,
    },
  });

  if (!incident) {
    return { status: "skipped" as const, reason: "incident_not_found" };
  }

  const command = detectSreCollaborationCommand(text);
  await recordCollaborationTimelineEvent({
    incidentId: incident.id,
    provider: parsed.provider,
    command,
    text,
    channelId: parsed.channelId,
    threadTs: parsed.threadTs,
    responderId: parsed.responderId,
    responderName: parsed.responderName,
  });

  if (!isResponderAllowed(parsed.responderId)) {
    return { status: "skipped" as const, incidentId: incident.id, reason: "responder_not_allowed" };
  }

  if (command === "acknowledge") {
    await db
      .update(sreIncidents)
      .set({ status: "investigating", updatedAt: new Date() })
      .where(eq(sreIncidents.id, incident.id));

    await db.insert(sreIncidentTimelineEvents).values({
      incidentId: incident.id,
      eventType: "state_change",
      actorType: "system",
      eventData: { type: "sre_collaboration_acknowledged", provider: parsed.provider },
      createdAt: new Date(),
    });

    return { status: "acknowledged" as const, incidentId: incident.id };
  }

  if (command === "resolve") {
    await db
      .update(sreIncidents)
      .set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(sreIncidents.id, incident.id));

    await db.insert(sreIncidentTimelineEvents).values({
      incidentId: incident.id,
      eventType: "state_change",
      actorType: "system",
      eventData: { type: "sre_collaboration_resolved", provider: parsed.provider },
      createdAt: new Date(),
    });

    return { status: "resolved" as const, incidentId: incident.id };
  }

  try {
    await assertCanStartSreInvestigation(incident.organizationId);
  } catch (error) {
    if (error instanceof SreInvestigationBillingError) {
      return { status: "billing_blocked" as const, incidentId: incident.id, reason: error.code };
    }

    throw error;
  }

  const useLiveConnectors = process.env.SRE_COLLABORATION_LIVE_CONNECTORS_ENABLED === "true";
  const startResult = await startSreIncidentInvestigation({
    organizationId: incident.organizationId,
    projectId: incident.projectId,
    userId: null,
    incidentId: incident.id,
    enableLiveConnectors: useLiveConnectors,
  });

  if (!startResult.success) {
    return { status: "investigation_failed" as const, incidentId: incident.id, reason: startResult.error };
  }

  void (async () => {
    try {
      const execResult = await executeSreIncidentInvestigation(
        startResult.investigationRunId,
        startResult.incident,
        {
          organizationId: incident.organizationId,
          projectId: incident.projectId,
          userId: null,
          incidentId: incident.id,
          enableLiveConnectors: useLiveConnectors,
        }
      );

      if (execResult.success) {
        await consumeSreInvestigationCredit({
          organizationId: incident.organizationId,
          projectId: incident.projectId,
          userId: null,
          incidentId: incident.id,
          investigationRunId: startResult.investigationRunId,
          useLiveConnectors,
        });

        if (parsed.provider === "slack") {
          await postSreInvestigationSlackSummary({
            channelId: parsed.channelId,
            threadTs: parsed.threadTs,
            incidentTitle: incident.title,
            incidentUrl: getIncidentDeepLink(incident.id),
            summary: execResult.summary,
          });
        }
      }
    } catch (error) {
      console.error("SRE collaboration investigation failed:", error);
    }
  })();

  return {
    status: "investigated" as const,
    incidentId: incident.id,
    investigationRunId: startResult.investigationRunId,
  };
}
