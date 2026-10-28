import { and, desc, eq, gte, inArray } from "drizzle-orm";

import {
  alertHistory,
  jobNotificationSettings,
  monitorNotificationSettings,
  notificationProviders,
  sreAlertEvents,
  sreIncidentAlerts,
  sreIncidents,
  sreServices,
  user,
  type PlainNotificationProviderConfig,
} from "@/db/schema";
import { renderIncidentUpdateEmail } from "@/lib/email-renderer";
import { EmailService } from "@/lib/email-service";
import { getDisplayStatus } from "@/lib/sre/incident-status-display";
import { decryptNotificationProviderConfig } from "@/lib/notification-providers/crypto";
import { createLogger } from "@/lib/logger/index";
import {
  normalizeWebhookHeaders,
  validateProviderConfig,
} from "@/lib/notification-providers/validation";
import { getRedisConnection } from "@/lib/queue";
import { fetchPublicEndpoint } from "@/lib/sre/connectors/pinned-fetch";
import { db } from "@/utils/db";

const logger = createLogger({ module: "sre-incident-notifier" }) as {
  warn: (data: unknown, message?: string) => void;
};

export type IncidentNotifyEvent =
  | "created"
  | "assigned"
  | "acknowledged"
  | "ai_finding"
  | "resolved"
  | "recovered"
  | "reopened";

type IncidentNotifyInput = {
  organizationId: string;
  projectId: string;
  incidentId: string;
  event: IncidentNotifyEvent;
  actorUserId?: string | null;
  /** Assignee for `assigned` / `created`; receives a direct email. */
  assigneeUserId?: string | null;
  /** Short, already-safe text (for example an AI conclusion headline). */
  detail?: string;
  /** Distinguishes repeats of one event, such as the investigation run id. */
  dedupeDiscriminator?: string;
  /** `resolved` by alert recovery rather than a person (channels already got the recovery alert). */
  automatic?: boolean;
};

const EVENT_LABEL: Record<IncidentNotifyEvent, string> = {
  created: "opened",
  assigned: "assigned",
  acknowledged: "acknowledged",
  ai_finding: "has an AI finding",
  resolved: "resolved",
  recovered: "recovered",
  reopened: "reopened",
};

const DEDUPE_TTL_SECONDS = 600;
const SEND_TIMEOUT_MS = 8000;
const MAX_DETAIL_LENGTH = 300;
const MAX_EMAIL_RECIPIENTS = 20;

export function buildIncidentUrl(incidentId: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/incidents/${incidentId}`;
}

/** Returns true when this incident+event has not been announced recently. Fails open without Redis. */
async function claimEvent(input: IncidentNotifyInput): Promise<boolean> {
  try {
    const redis = await getRedisConnection();
    const key = `supercheck:sre:incident-notify:${input.incidentId}:${input.event}:${input.dedupeDiscriminator ?? input.assigneeUserId ?? ""}`;
    return (await redis.set(key, "1", "EX", DEDUPE_TTL_SECONDS, "NX")) === "OK";
  } catch (error) {
    logger.warn({ error }, "Incident notification dedupe unavailable; sending anyway");
    return true;
  }
}

type Message = {
  title: string;
  text: string;
  url: string;
  event: IncidentNotifyEvent;
  incident: { id: string; number: number; severity: string; status: string };
  email: { title: string; statusLabel: string; serviceName?: string; detail?: string };
};

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetchPublicEndpoint(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // Status only: the URL can carry a bot token.
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function sendEmail(recipients: string[], message: Message) {
  const unique = [...new Set(recipients.map((r) => r.trim()).filter(Boolean))].slice(0, MAX_EMAIL_RECIPIENTS);
  if (unique.length === 0) return;
  let rendered: { subject: string; html: string; text: string };
  try {
    rendered = await renderIncidentUpdateEmail({
      event: message.event,
      incidentNumber: message.incident.number,
      title: message.email.title,
      severity: message.incident.severity as "sev1" | "sev2" | "sev3" | "sev4",
      statusLabel: message.email.statusLabel,
      serviceName: message.email.serviceName,
      detail: message.email.detail,
      incidentUrl: message.url,
    });
  } catch (error) {
    // Never drop the email because a template failed; send the plain version.
    logger.warn({ error }, "Incident email template failed; sending plain email");
    rendered = {
      subject: message.title,
      text: `${message.text}\n\n${message.url}`,
      html: `<p>${escapeHtml(message.text)}</p><p><a href="${escapeHtml(message.url)}">Open incident #${message.incident.number}</a></p>`,
    };
  }
  await EmailService.getInstance().sendEmailToMultiple({ recipients: unique, ...rendered });
}

function hasCustomWebhookBody(config: Record<string, unknown>) {
  const preset = typeof config.preset === "string" ? config.preset.trim() : "";
  const template = typeof config.bodyTemplate === "string" ? config.bodyTemplate.trim() : "";
  return (preset !== "" && preset !== "custom") || template !== "";
}

async function sendToProvider(
  provider: { type: string; config: PlainNotificationProviderConfig },
  message: Message,
) {
  const config = provider.config as Record<string, unknown>;
  const line = `${message.text}\n${message.url}`;
  switch (provider.type) {
    case "email":
      return sendEmail(String(config.emails ?? "").split(","), message);
    case "slack":
      await post(String(config.webhookUrl), { text: line });
      return;
    case "teams":
      await post(String(config.teamsWebhookUrl), { text: line });
      return;
    case "discord":
      await post(String(config.discordWebhookUrl), { content: line });
      return;
    case "telegram":
      // Plain text: no parse_mode, so incident titles cannot inject markup.
      await post(`https://api.telegram.org/bot${String(config.botToken)}/sendMessage`, {
        chat_id: String(config.chatId),
        text: line,
        disable_web_page_preview: true,
      });
      return;
    case "webhook":
      // Presets and body templates shape payloads for one specific receiver; the fixed incident
      // JSON would be wrong for them, so only plain webhooks receive incident messages.
      if (hasCustomWebhookBody(config)) {
        logger.warn({ type: "webhook" }, "Incident notification skipped for a webhook with a preset or body template");
        return;
      }
      await post(
        String(config.url),
        { event: `incident.${message.event}`, ...message.incident, title: message.title, text: message.text, url: message.url },
        normalizeWebhookHeaders(config.headers),
      );
      return;
  }
}

/** True when a failure alert for this source was delivered (status `sent`) in the last 15 minutes. */
async function triggerAlertDelivered(sourceType: "monitor" | "job", sourceId: string) {
  const rows = await db
    .select({ status: alertHistory.status })
    .from(alertHistory)
    .where(
      and(
        sourceType === "monitor" ? eq(alertHistory.monitorId, sourceId) : eq(alertHistory.jobId, sourceId),
        inArray(alertHistory.type, ["monitor_failure", "job_failed", "job_timeout", "ssl_expiring"]),
        gte(alertHistory.sentAt, new Date(Date.now() - 15 * 60_000)),
      ),
    )
    .orderBy(desc(alertHistory.sentAt))
    .limit(20);
  return rows.some((row) => row.status === "sent");
}

/**
 * Announce an incident lifecycle event through the notification providers the
 * triggering monitor or job already uses, plus a direct email to the assignee.
 * Best effort: never throws, never carries raw evidence or secrets.
 */
export async function notifyIncidentEvent(input: IncidentNotifyInput): Promise<void> {
  try {
    if (!(await claimEvent(input))) return;

    const [incident] = await db
      .select({
        id: sreIncidents.id,
        number: sreIncidents.incidentNumber,
        title: sreIncidents.title,
        severity: sreIncidents.severity,
        status: sreIncidents.status,
        acknowledgedAt: sreIncidents.acknowledgedAt,
        assigneeUserId: sreIncidents.assigneeUserId,
        serviceName: sreServices.name,
      })
      .from(sreIncidents)
      .leftJoin(sreServices, eq(sreServices.id, sreIncidents.primaryServiceId))
      .where(
        and(
          eq(sreIncidents.id, input.incidentId),
          eq(sreIncidents.organizationId, input.organizationId),
          eq(sreIncidents.projectId, input.projectId),
        ),
      )
      .limit(1);
    if (!incident) return;

    const url = buildIncidentUrl(incident.id);
    const detail = input.detail?.replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL_LENGTH);
    const text =
      `[${incident.severity.toUpperCase()}] Incident #${incident.number} ${EVENT_LABEL[input.event]}: ${incident.title}` +
      (incident.serviceName ? ` (${incident.serviceName})` : "") +
      (detail ? `\n${detail}` : "");
    const message: Message = {
      title: `Incident #${incident.number} ${EVENT_LABEL[input.event]}`,
      text,
      url,
      event: input.event,
      incident: { id: incident.id, number: incident.number, severity: incident.severity, status: incident.status },
      email: {
        title: incident.title,
        statusLabel: getDisplayStatus(incident.status, incident.acknowledgedAt).label,
        serviceName: incident.serviceName ?? undefined,
        detail,
      },
    };

    // Direct email to the person who now owns it (not to themselves).
    const directTo = ["assigned", "created", "recovered", "reopened"].includes(input.event) ? input.assigneeUserId : null;
    if (directTo && directTo !== input.actorUserId) {
      const [assignee] = await db.select({ email: user.email }).from(user).where(eq(user.id, directTo)).limit(1);
      if (assignee?.email) await sendEmail([assignee.email], message);
    }

    // Providers linked to the monitor/job that raised the alert; manual incidents have none.
    const [source] = await db
      .select({ sourceType: sreAlertEvents.sourceType, sourceId: sreAlertEvents.sourceId })
      .from(sreIncidentAlerts)
      .innerJoin(sreAlertEvents, eq(sreAlertEvents.id, sreIncidentAlerts.alertEventId))
      .where(and(eq(sreIncidentAlerts.incidentId, incident.id), eq(sreIncidentAlerts.role, "trigger")))
      .limit(1);
    if (!source?.sourceId || (source.sourceType !== "monitor" && source.sourceType !== "job")) return;

    // One message per event: the worker already posted the alert (created) and the
    // recovery (automatic resolve, recovered) to these channels.
    // `created` is skipped only when the worker's alert was actually delivered; if every
    // delivery failed, the channels have not heard about it yet.
    if (input.event === "recovered" || input.event === "reopened" || (input.event === "resolved" && input.automatic)) return;
    if (input.event === "created" && (await triggerAlertDelivered(source.sourceType, source.sourceId))) return;

    const providerColumns = {
      id: notificationProviders.id,
      type: notificationProviders.type,
      config: notificationProviders.config,
      projectId: notificationProviders.projectId,
    };
    const providerScope = and(
      eq(notificationProviders.isEnabled, true),
      eq(notificationProviders.organizationId, input.organizationId),
      eq(notificationProviders.projectId, input.projectId),
    );
    const providers =
      source.sourceType === "monitor"
        ? await db
            .select(providerColumns)
            .from(monitorNotificationSettings)
            .innerJoin(notificationProviders, eq(notificationProviders.id, monitorNotificationSettings.notificationProviderId))
            .where(and(eq(monitorNotificationSettings.monitorId, source.sourceId), providerScope))
            .limit(10)
        : await db
            .select(providerColumns)
            .from(jobNotificationSettings)
            .innerJoin(notificationProviders, eq(notificationProviders.id, jobNotificationSettings.notificationProviderId))
            .where(and(eq(jobNotificationSettings.jobId, source.sourceId), providerScope))
            .limit(10);

    await Promise.allSettled(
      providers.map(async (provider) => {
        try {
          // Provider configs are stored as encrypted envelopes bound to their project.
          const config = decryptNotificationProviderConfig(provider.config, provider.projectId ?? undefined);
          validateProviderConfig(provider.type, config);
          await sendToProvider({ type: provider.type, config }, message);
        } catch (error) {
          logger.warn({ providerId: provider.id, type: provider.type, error: error instanceof Error ? error.message : "send failed" }, "Incident notification delivery failed");
        }
      }),
    );
  } catch (error) {
    logger.warn({ incidentId: input.incidentId, event: input.event, error: error instanceof Error ? error.message : "notify failed" }, "Incident notification skipped");
  }
}
