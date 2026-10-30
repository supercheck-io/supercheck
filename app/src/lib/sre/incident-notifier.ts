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
import { type DetailField } from "@/emails/base-layout";
import {
  INCIDENT_EVENT_COLOR,
  INCIDENT_EVENT_MESSAGE,
  incidentUpdateFields,
  incidentUpdateHeadline,
} from "@/emails/incident-update";
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
  /** The assignee being replaced on `assigned`; told the incident moved. */
  previousAssigneeUserId?: string | null;
  /** Short, already-safe text (for example an AI conclusion headline). */
  detail?: string;
  /** Distinguishes repeats of one event, such as the investigation run id. */
  dedupeDiscriminator?: string;
  /** `resolved` or `reopened` by the alert flow rather than a person (channels already got the alert). */
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
  /** Event headline, for example "Incident acknowledged by Ada". */
  headline: string;
  /** Event detail, or the standard explanation for the event. */
  body: string;
  fields: DetailField[];
  email: {
    title: string;
    statusLabel: string;
    serviceName?: string;
    detail?: string;
    actorName?: string;
    assigneeName?: string;
  };
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

/** Slack treats <...> as links and mentions (<!channel>), so user text must escape them. */
function escapeSlack(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function plainText(message: Message) {
  const facts = message.fields.map((field) => `${field.title}: ${field.value}`).join("\n");
  return `${message.text}\n\n${facts}\n\n${message.url}`;
}

async function sendEmail(recipients: string[], message: Message) {
  const all = [...new Set(recipients.map((r) => r.trim()).filter(Boolean))];
  if (all.length > MAX_EMAIL_RECIPIENTS) {
    logger.warn({ recipients: all.length, max: MAX_EMAIL_RECIPIENTS }, "Incident email recipient list truncated");
  }
  const unique = all.slice(0, MAX_EMAIL_RECIPIENTS);
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
      actorName: message.email.actorName,
      assigneeName: message.email.assigneeName,
    });
  } catch (error) {
    // Never drop the email because a template failed; send the plain version with the same facts.
    logger.warn({ error }, "Incident email template failed; sending plain email");
    const rows = message.fields
      .map((field) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280"><b>${escapeHtml(field.title)}</b></td><td>${escapeHtml(field.value)}</td></tr>`)
      .join("");
    rendered = {
      subject: `[${message.incident.severity.toUpperCase()}] ${message.headline}: #${message.incident.number} ${message.email.title}`,
      text: plainText(message),
      html: `<p><b>${escapeHtml(message.headline)}</b></p><p>${escapeHtml(message.text)}</p><table>${rows}</table><p><a href="${escapeHtml(message.url)}">Open incident #${message.incident.number}</a></p>`,
    };
  }
  const result = await EmailService.getInstance().sendEmailToMultiple({ recipients: unique, ...rendered });
  if (result.failedAddresses.length > 0) {
    throw new Error(`email failed for ${result.failedAddresses.length}/${unique.length} recipient(s)`);
  }
}

function hasCustomWebhookBody(config: Record<string, unknown>) {
  const preset = typeof config.preset === "string" ? config.preset.trim() : "";
  const template = typeof config.bodyTemplate === "string" ? config.bodyTemplate.trim() : "";
  return (preset !== "" && preset !== "custom") || template !== "";
}

const TEAMS_COLOR: Partial<Record<IncidentNotifyEvent, string>> = {
  created: "attention",
  reopened: "attention",
  resolved: "good",
  recovered: "good",
};

async function sendToProvider(
  provider: { type: string; config: PlainNotificationProviderConfig },
  message: Message,
) {
  const config = provider.config as Record<string, unknown>;
  const color = INCIDENT_EVENT_COLOR[message.event] ?? "#1f2937";
  const heading = `#${message.incident.number} ${message.email.title}`;
  switch (provider.type) {
    case "email":
      return sendEmail(String(config.emails ?? "").split(","), message);
    case "slack":
      await post(String(config.webhookUrl), {
        text: escapeSlack(`${message.headline}: ${heading}`),
        attachments: [
          {
            color,
            title: escapeSlack(heading),
            title_link: message.url,
            text: escapeSlack(message.body),
            fields: message.fields.map((field) => ({ title: escapeSlack(field.title), value: escapeSlack(field.value), short: true })),
            footer: "Supercheck",
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      });
      return;
    case "teams":
      // Teams Workflows webhooks only accept Adaptive Card attachments, not { text }.
      await post(String(config.teamsWebhookUrl), {
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
              $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
              type: "AdaptiveCard",
              version: "1.4",
              body: [
                { type: "TextBlock", text: message.headline, weight: "bolder", size: "large", color: TEAMS_COLOR[message.event] ?? "default", wrap: true },
                { type: "TextBlock", text: heading, weight: "bolder", wrap: true },
                { type: "TextBlock", text: message.body, wrap: true, spacing: "small" },
                { type: "FactSet", facts: message.fields.map((field) => ({ title: field.title, value: field.value })), spacing: "medium" },
              ],
              actions: [{ type: "Action.OpenUrl", title: `Open incident #${message.incident.number}`, url: message.url }],
            },
          },
        ],
      });
      return;
    case "discord":
      await post(String(config.discordWebhookUrl), {
        content: clip(message.headline, 2000),
        embeds: [
          {
            title: clip(heading, 256),
            url: message.url,
            description: clip(message.body, 4096),
            color: parseInt(color.slice(1), 16),
            fields: message.fields.map((field) => ({ name: field.title, value: clip(field.value, 1024), inline: true })),
            footer: { text: "Supercheck" },
            timestamp: new Date().toISOString(),
          },
        ],
        // Incident titles are user text; never let them ping @everyone or roles.
        allowed_mentions: { parse: [] },
      });
      return;
    case "telegram":
      // Plain text: no parse_mode, so incident titles cannot inject markup.
      await post(`https://api.telegram.org/bot${String(config.botToken)}/sendMessage`, {
        chat_id: String(config.chatId),
        // Clip the body, never the trailing link (Telegram's limit is 4096 characters).
        text: `${clip(`${message.headline}\n${plainText({ ...message, url: "" }).trimEnd()}`, 4000)}\n\n${message.url}`,
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

// System events can repeat every check cycle while a monitor flaps.
const SYSTEM_EVENTS: IncidentNotifyEvent[] = ["recovered", "reopened"];

/** Emails of participants who can still act on the incident, at most one per person per window for system events. */
async function participantEmails(
  input: IncidentNotifyInput,
  participantIds: string[],
  person: (id?: string | null) => { email: string } | undefined,
) {
  if (participantIds.length === 0) return [];
  // Lazy import: incident-lifecycle imports this module.
  const { listAssignableUsers } = await import("./incident-lifecycle");
  const assignable = new Set((await listAssignableUsers(input.organizationId, input.projectId)).map((row) => row.id));
  const emails: string[] = [];
  for (const id of participantIds) {
    const email = person(id)?.email;
    if (!email || !assignable.has(id)) continue;
    if (SYSTEM_EVENTS.includes(input.event) && !(await claimRecipient(input, id))) continue;
    emails.push(email);
  }
  return emails;
}

async function claimRecipient(input: IncidentNotifyInput, userId: string) {
  try {
    const redis = await getRedisConnection();
    const key = `supercheck:sre:incident-email:${input.incidentId}:${input.event}:${userId}`;
    return (await redis.set(key, "1", "EX", DEDUPE_TTL_SECONDS, "NX")) === "OK";
  } catch {
    return true;
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
        commanderUserId: sreIncidents.commanderUserId,
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

    // Participants (owner, commander, and the owner being replaced) get a direct email for
    // every lifecycle change, like ticket watchers; never the person who made the change.
    const ownerId = input.assigneeUserId ?? incident.assigneeUserId;
    const participantIds =
      input.event === "ai_finding"
        ? []
        : [...new Set([ownerId, incident.commanderUserId, input.previousAssigneeUserId])].filter(
            (id): id is string => Boolean(id) && id !== input.actorUserId,
          );
    const personIds = [...new Set([input.actorUserId, ownerId, ...participantIds].filter((id): id is string => Boolean(id)))];
    // Names are cosmetic: a failed lookup must not stop the channel posts below.
    const people = personIds.length
      ? await db
          .select({ id: user.id, name: user.name, email: user.email })
          .from(user)
          .where(inArray(user.id, personIds))
          .limit(personIds.length)
          .catch((error: unknown) => {
            logger.warn({ error: error instanceof Error ? error.message : "lookup failed" }, "Incident notification name lookup failed");
            return [];
          })
      : [];
    const person = (id?: string | null) => (id ? people.find((row) => row.id === id) : undefined);
    const actorName = person(input.actorUserId)?.name || undefined;
    const assigneeName = person(ownerId)?.name || undefined;

    const statusLabel = getDisplayStatus(incident.status, incident.acknowledgedAt).label;
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
      headline: incidentUpdateHeadline(input.event, actorName, assigneeName),
      body: detail || INCIDENT_EVENT_MESSAGE[input.event],
      fields: incidentUpdateFields({
        incidentNumber: incident.number,
        severity: incident.severity as "sev1" | "sev2" | "sev3" | "sev4",
        statusLabel,
        serviceName: incident.serviceName ?? undefined,
        assigneeName,
        actorName,
      }),
      email: {
        title: incident.title,
        statusLabel,
        serviceName: incident.serviceName ?? undefined,
        detail,
        actorName,
        assigneeName,
      },
    };

    const directEmails = await participantEmails(input, participantIds, person);
    if (directEmails.length > 0) {
      try {
        await sendEmail(directEmails, message);
      } catch (error) {
        logger.warn({ incidentId: incident.id, error: error instanceof Error ? error.message : "send failed" }, "Incident email to participants failed");
      }
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
    if (input.event === "recovered" || ((input.event === "reopened" || input.event === "resolved") && input.automatic)) return;
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
