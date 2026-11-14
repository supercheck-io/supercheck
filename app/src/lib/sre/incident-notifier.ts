import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";

import {
  alertHistory,
  jobNotificationSettings,
  sreIncidentTimelineEvents,
  monitorNotificationSettings,
  notificationProviders,
  sreAlertEvents,
  sreIncidentAlerts,
  sreIncidents,
  sreServiceOwners,
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
import { safeText } from "@/lib/mcp/redact";
import { decryptNotificationProviderConfig } from "@/lib/notification-providers/crypto";
import { createLogger } from "@/lib/logger/index";
import {
  normalizeWebhookHeaders,
  validateProviderConfig,
} from "@/lib/notification-providers/validation";
import { getRedisConnection } from "@/lib/queue";
import { fetchChannelWebhookEndpoint, fetchPublicEndpoint } from "@/lib/sre/connectors/pinned-fetch";
import { listProjectAdmins, listWatchers } from "@/lib/sre/incident-watchers";
import { getNotificationPolicy, isPagingWebhook, listPolicyProviders } from "@/lib/sre/notification-policy";
import { isUuid } from "@/lib/uuid";
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
  | "reopened"
  | "commented"
  | "severity_changed"
  | "unacknowledged"
  | "escalated";

/** Where a `created` message went because the worker's own alert did not reach anyone. */
export type IncidentFallback = "policy_channels" | "admins" | "none";

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
  /** `escalated`: the policy's one target, replacing the policy channel lookup. */
  targets?: { providerIds?: string[]; userIds?: string[] };
  /** `unacknowledged`: which reminder this is, for the timeline. */
  reminder?: { n: number; of: number };
  /** `created`, or an automatic `reopened`: the alert_history row behind it, so delivery is judged for this outage or run only. */
  triggerAlertHistoryId?: string;
  /** Filled in for `created`: where the message went when the trigger alert was not delivered. */
  report?: { fallback?: IncidentFallback };
};

const EVENT_LABEL: Record<IncidentNotifyEvent, string> = {
  created: "opened",
  assigned: "assigned",
  acknowledged: "acknowledged",
  ai_finding: "has an AI finding",
  resolved: "resolved",
  recovered: "recovered",
  reopened: "reopened",
  commented: "has a new note",
  severity_changed: "changed severity",
  unacknowledged: "is still unacknowledged",
  escalated: "was escalated (still unacknowledged)",
};

/** Emailed to the owner, commander and watchers only: the text can be internal, so channels never get it. */
const PEOPLE_ONLY_EVENTS: IncidentNotifyEvent[] = ["commented", "severity_changed"];
const MAX_POLICY_OWNERS = 5;

const DEDUPE_TTL_SECONDS = 600;
const SEND_TIMEOUT_MS = 8000;
const MAX_DETAIL_LENGTH = 300;
const MAX_EMAIL_RECIPIENTS = 20;
/** Direct (participant and watcher) mail may span several batches. */
const MAX_DIRECT_RECIPIENTS = 120;

export function buildIncidentUrl(incidentId: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/incidents/${incidentId}`;
}

/** Returns true when this incident+event has not been announced recently. Fails open without Redis. */
function eventKey(input: IncidentNotifyInput) {
  return `supercheck:sre:incident-notify:${input.incidentId}:${input.event}:${input.dedupeDiscriminator ?? input.assigneeUserId ?? ""}`;
}

/** When every provider failed, the event was never announced; free the key so a retry can send. */
async function releaseEvent(input: IncidentNotifyInput, token: string) {
  if (!token) return;
  // Retried: a key left behind suppresses the re-notify for DEDUPE_TTL_SECONDS and the reminder is lost.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const redis = await getRedisConnection();
      // Compare-and-delete: never free a key another invocation has since claimed (so retrying is safe).
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        eventKey(input),
        token,
      );
      return;
    } catch {
      // Best effort; the key expires on its own.
    }
  }
}

/** Returns a claim token, or null when already announced; fails open (empty token) without Redis. */
async function claimEvent(input: IncidentNotifyInput): Promise<string | null> {
  try {
    const redis = await getRedisConnection();
    const key = eventKey(input);
    const token = randomUUID();
    return (await redis.set(key, token, "EX", DEDUPE_TTL_SECONDS, "NX")) === "OK" ? token : null;
  } catch (error) {
    logger.warn({ error }, "Incident notification dedupe unavailable; sending anyway");
    return "";
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

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  fetcher: typeof fetchPublicEndpoint = fetchPublicEndpoint,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
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

/** Teams and Discord render markdown, so user text must not become links or formatting. */
function escapeMarkdown(value: string) {
  return value.replace(/[\\`*_~|<>[\]()]/g, "\\$&");
}

/** Discord descriptions also render line-leading # as headings. */
function escapeDiscordDescription(value: string) {
  return escapeMarkdown(value).replace(/^(#+)/gm, "\\$1");
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function plainText(message: Message) {
  const facts = message.fields.map((field) => `${field.title}: ${field.value}`).join("\n");
  return `${message.text}\n\n${facts}\n\n${message.url}`;
}

/** Sends in batches of MAX_EMAIL_RECIPIENTS so nobody who was throttled-in is silently dropped; `max` bounds the total. */
async function sendEmail(recipients: string[], message: Message, max = MAX_EMAIL_RECIPIENTS) {
  const all = [...new Set(recipients.map((r) => r.trim()).filter(Boolean))];
  if (all.length > max) {
    logger.warn({ recipients: all.length, max }, "Incident email recipient list truncated");
  }
  const unique = all.slice(0, max);
  if (unique.length === 0) return;
  let failures = 0;
  for (let index = 0; index < unique.length; index += MAX_EMAIL_RECIPIENTS) {
    failures += await sendEmailBatch(unique.slice(index, index + MAX_EMAIL_RECIPIENTS), message);
  }
  if (failures > 0) throw new Error(`email failed for ${failures}/${unique.length} recipient(s)`);
}

/** Returns how many recipients failed. */
async function sendEmailBatch(unique: string[], message: Message): Promise<number> {
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
      subject: `[Supercheck] ${message.headline}: #${message.incident.number} ${message.email.title} (${message.incident.severity.toUpperCase()})`,
      text: plainText(message),
      html: `<p><b>${escapeHtml(message.headline)}</b></p><p>${escapeHtml(message.text)}</p><table>${rows}</table><p><a href="${escapeHtml(message.url)}">Open incident #${message.incident.number}</a></p>`,
    };
  }
  const result = await EmailService.getInstance().sendEmailToMultiple({ recipients: unique, ...rendered });
  return result.failedAddresses.length;
}

const TEAMS_COLOR: Partial<Record<IncidentNotifyEvent, string>> = {
  created: "attention",
  reopened: "attention",
  resolved: "good",
  recovered: "good",
};

/** Resolves true when a message went out, false when this provider type deliberately sends nothing. */
async function sendToProvider(
  provider: { type: string; config: PlainNotificationProviderConfig },
  message: Message,
): Promise<boolean> {
  const config = provider.config as Record<string, unknown>;
  const color = INCIDENT_EVENT_COLOR[message.event] ?? "#1f2937";
  const heading = `#${message.incident.number} ${message.email.title}`;
  switch (provider.type) {
    case "email":
      await sendEmail(String(config.emails ?? "").split(","), message);
      return true;
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
      return true;
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
                { type: "TextBlock", text: escapeMarkdown(message.headline), weight: "bolder", size: "large", color: TEAMS_COLOR[message.event] ?? "default", wrap: true },
                { type: "TextBlock", text: escapeMarkdown(heading), weight: "bolder", wrap: true },
                { type: "TextBlock", text: escapeMarkdown(message.body), wrap: true, spacing: "small" },
                { type: "FactSet", facts: message.fields.map((field) => ({ title: escapeMarkdown(field.title), value: escapeMarkdown(field.value) })), spacing: "medium" },
              ],
              actions: [{ type: "Action.OpenUrl", title: `Open incident #${message.incident.number}`, url: message.url }],
            },
          },
        ],
      });
      return true;
    case "discord":
      await post(String(config.discordWebhookUrl), {
        content: clip(escapeMarkdown(message.headline), 2000),
        embeds: [
          {
            title: clip(escapeMarkdown(heading), 256),
            url: message.url,
            description: clip(escapeDiscordDescription(message.body), 4096),
            color: parseInt(color.slice(1), 16),
            fields: message.fields.map((field) => ({ name: clip(escapeMarkdown(field.title), 256), value: clip(escapeMarkdown(field.value), 1024), inline: true })),
            footer: { text: "Supercheck" },
            timestamp: new Date().toISOString(),
          },
        ],
        // Incident titles are user text; never let them ping @everyone or roles.
        allowed_mentions: { parse: [] },
      });
      return true;
    case "telegram":
      // Plain text: no parse_mode, so incident titles cannot inject markup.
      await post(`https://api.telegram.org/bot${String(config.botToken)}/sendMessage`, {
        chat_id: String(config.chatId),
        // Clip the body, never the trailing link (Telegram's limit is 4096 characters).
        text: `${clip(`${message.headline}\n${plainText({ ...message, url: "" }).trimEnd()}`, 4000)}\n\n${message.url}`,
        disable_web_page_preview: true,
      });
      return true;
    case "webhook":
      // Presets and body templates shape payloads for one specific receiver; the fixed incident
      // JSON would be wrong for them, so only plain webhooks receive incident messages.
      // Filtered out before sending (notifyIncidentEvent); kept here so no caller can post the fixed JSON to one.
      if (isPagingWebhook("webhook", config)) return false;
      await post(
        String(config.url),
        { event: `incident.${message.event}`, ...message.incident, title: message.title, text: message.text, url: message.url },
        normalizeWebhookHeaders(config.headers),
        fetchChannelWebhookEndpoint,
      );
      return true;
  }
  return false;
}

// System events can repeat every check cycle while a monitor flaps.
const SYSTEM_EVENTS: IncidentNotifyEvent[] = ["recovered", "reopened"];

/** Emails of participants who can still act on the incident, at most one per person per window for alert-driven events. */
async function participantEmails(
  input: IncidentNotifyInput,
  participantIds: string[],
  person: (id?: string | null) => { email: string } | undefined,
) {
  if (participantIds.length === 0) return { emails: [], claimed: [] };
  try {
    // Lazy import: incident-lifecycle imports this module.
    const { isAssignableUser } = await import("./incident-lifecycle");
    const throttled = isThrottledEmail(input);
    const emails: string[] = [];
    const claimed: string[] = [];
    for (const id of participantIds) {
      const email = person(id)?.email;
      if (!email || !(await isAssignableUser(input.organizationId, input.projectId, id))) continue;
      if (throttled) {
        if (!(await claimRecipient(input, id))) continue;
        claimed.push(id);
      }
      emails.push(email);
    }
    return { emails, claimed };
  } catch (error) {
    // Channel posts below must still go out.
    logger.warn({ error: error instanceof Error ? error.message : "lookup failed" }, "Incident participant lookup failed");
    return { emails: [], claimed: [] };
  }
}

/** Notes and severity edits can come in bursts: at most one email per person per incident per event per window. */
const BURST_EVENT_TTL_SECONDS = 300;

function isThrottledEmail(input: IncidentNotifyInput) {
  return SYSTEM_EVENTS.includes(input.event) || PEOPLE_ONLY_EVENTS.includes(input.event) || (input.event === "resolved" && input.automatic === true);
}

function recipientKey(input: IncidentNotifyInput, userId: string) {
  return `supercheck:sre:incident-email:${input.incidentId}:${input.event}:${userId}`;
}

async function claimRecipient(input: IncidentNotifyInput, userId: string) {
  try {
    const redis = await getRedisConnection();
    const ttl = PEOPLE_ONLY_EVENTS.includes(input.event) ? BURST_EVENT_TTL_SECONDS : DEDUPE_TTL_SECONDS;
    return (await redis.set(recipientKey(input, userId), "1", "EX", ttl, "NX")) === "OK";
  } catch {
    return true;
  }
}

/** A failed send must not use up the window, or the next event would be suppressed too. */
async function releaseRecipients(input: IncidentNotifyInput, userIds: string[]) {
  if (userIds.length === 0) return;
  try {
    const redis = await getRedisConnection();
    await redis.del(...userIds.map((id) => recipientKey(input, id)));
  } catch {
    // Best effort; the claim expires on its own.
  }
}

const TRIGGER_ALERT_TYPES = ["monitor_failure", "job_failed", "job_timeout", "ssl_expiring"] as const;

/**
 * True when the triggering alert (its own type, not any alert for the source) was delivered (status `sent`) to some
 * channel. With the triggering row known, only rows of the same outage (monitors) or run (jobs) count, so a delivery
 * from an earlier outage cannot hide a failed page; otherwise any such row in the last 15 minutes.
 */
async function triggerAlertDelivered(sourceType: "monitor" | "job", sourceId: string, dedupKey: string | null, triggerAlertHistoryId?: string) {
  // Alert event dedup keys end with the alert type (see background-alert-triage).
  const keyType = dedupKey?.split(":").pop();
  const types = TRIGGER_ALERT_TYPES.filter((type) => type === keyType);
  const [trigger] = triggerAlertHistoryId && isUuid(triggerAlertHistoryId)
    ? await db
        .select({ outageKey: alertHistory.outageKey, runId: alertHistory.runId })
        .from(alertHistory)
        .where(and(eq(alertHistory.id, triggerAlertHistoryId), sourceType === "monitor" ? eq(alertHistory.monitorId, sourceId) : eq(alertHistory.jobId, sourceId)))
        .limit(1)
    : [];
  const sameEpisode =
    sourceType === "monitor" && trigger?.outageKey
      ? eq(alertHistory.outageKey, trigger.outageKey)
      : sourceType === "job" && trigger?.runId
        ? eq(alertHistory.runId, trigger.runId)
        : gte(alertHistory.sentAt, new Date(Date.now() - 15 * 60_000));
  const rows = await db
    .select({ status: alertHistory.status })
    .from(alertHistory)
    .where(
      and(
        sourceType === "monitor" ? eq(alertHistory.monitorId, sourceId) : eq(alertHistory.jobId, sourceId),
        inArray(alertHistory.type, types.length ? types : [...TRIGGER_ALERT_TYPES]),
        sameEpisode,
      ),
    )
    .orderBy(desc(alertHistory.sentAt))
    .limit(20);
  return rows.some((row) => row.status === "sent");
}

/** Owner user and primary user owners of the service, for the policy's SEV1-2 email. */
async function serviceOwnerIds(serviceId: string | null) {
  if (!serviceId) return [];
  const [service] = await db
    .select({ ownerUserId: sreServices.ownerUserId })
    .from(sreServices)
    .where(eq(sreServices.id, serviceId))
    .limit(1);
  const owners = await db
    .select({ ownerRef: sreServiceOwners.ownerRef })
    .from(sreServiceOwners)
    .where(and(eq(sreServiceOwners.serviceId, serviceId), eq(sreServiceOwners.ownerType, "user")))
    .limit(MAX_POLICY_OWNERS);
  return [service?.ownerUserId, ...owners.map((owner) => owner.ownerRef)].filter(
    (id): id is string => typeof id === "string" && isUuid(id),
  );
}

/**
 * Announce an incident lifecycle event through the notification providers the
 * triggering monitor or job already uses, plus a direct email to the assignee.
 * Best effort: never throws, never carries raw evidence or secrets.
 */
export async function notifyIncidentEvent(input: IncidentNotifyInput): Promise<boolean> {
  // Counts real send attempts, so the caller can tell "nothing to send" from "everything failed".
  let attempted = 0;
  let sent = 0;
  let claim: string | null = null;
  try {
    claim = await claimEvent(input);
    if (claim === null) return true;

    const [incident] = await db
      .select({
        id: sreIncidents.id,
        number: sreIncidents.incidentNumber,
        title: sreIncidents.title,
        severity: sreIncidents.severity,
        status: sreIncidents.status,
        acknowledgedAt: sreIncidents.acknowledgedAt,
        renotifyStoppedAt: sreIncidents.renotifyStoppedAt,
        assigneeUserId: sreIncidents.assigneeUserId,
        commanderUserId: sreIncidents.commanderUserId,
        serviceId: sreIncidents.primaryServiceId,
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
    if (!incident) return true;
    // The reminder is claimed before it is sent; someone may have acknowledged or resolved since.
    // Also stopped when a person lowered the severity after the claim.
    if ((input.event === "unacknowledged" || input.event === "escalated") && (incident.acknowledgedAt || incident.status === "resolved" || incident.renotifyStoppedAt)) return true;

    const url = buildIncidentUrl(incident.id);
    const detail = input.detail?.replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL_LENGTH);

    // Participants (owner, commander, and the owner being replaced) get a direct email for
    // every lifecycle change, like ticket watchers; never the person who made the change.
    const ownerId = input.assigneeUserId ?? incident.assigneeUserId;
    const policy = await getNotificationPolicy(input.projectId).catch(() => null);
    // The project policy can add the service's owners to a SEV1-2 opening.
    const policyOwnerIds =
      input.event === "created" && policy?.emailServiceOwnersOnSev12 && ["sev1", "sev2"].includes(incident.severity)
        ? await serviceOwnerIds(incident.serviceId).catch(() => [])
        : [];
    // Escalation goes to its one target only (below), never the owner who did not acknowledge.
    const participantIds =
      input.event === "ai_finding" || input.event === "escalated"
        ? []
        : [...new Set([ownerId, incident.commanderUserId, input.previousAssigneeUserId, ...policyOwnerIds])].filter(
            (id): id is string => Boolean(id) && id !== input.actorUserId,
          );
    // Watchers hear about notes and severity changes; viewers may watch, so they skip the editor check.
    const watcherCandidates = PEOPLE_ONLY_EVENTS.includes(input.event)
      ? (await listWatchers(input.organizationId, input.projectId, incident.id).catch(() => [])).filter(
          (watcher) => watcher.id !== input.actorUserId,
        )
      : [];
    const watchers: typeof watcherCandidates = [];
    const claimedWatchers: string[] = [];
    for (const watcher of watcherCandidates) {
      // A person who is also a participant is claimed once, in participantEmails.
      if (participantIds.includes(watcher.id) || !(await claimRecipient(input, watcher.id))) continue;
      watchers.push(watcher);
      claimedWatchers.push(watcher.id);
    }
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
    // The title is user text sent to email and chat providers: redact credentials and bound its length.
    const title = safeText(incident.title, 300) ?? "";
    const text =
      `[${incident.severity.toUpperCase()}] Incident #${incident.number} ${EVENT_LABEL[input.event]}: ${title}` +
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
        title,
        statusLabel,
        serviceName: incident.serviceName ?? undefined,
        detail,
        actorName,
        assigneeName,
      },
    };

    // A member escalation target counts as a participant: same can-act check, re-done at send time.
    const escalateUserIds = input.event === "escalated" ? (input.targets?.userIds ?? []).filter(isUuid) : [];
    const targetPeople = escalateUserIds.length
      ? await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(inArray(user.id, escalateUserIds)).limit(escalateUserIds.length)
      : [];
    const direct = await participantEmails(input, [...participantIds, ...escalateUserIds], (id) => person(id) ?? targetPeople.find((row) => row.id === id));
    const directEmails = [...direct.emails, ...watchers.map((watcher) => watcher.email)];
    let emailed = 0;
    if (directEmails.length > 0) {
      attempted += 1;
      try {
        await sendEmail(directEmails, message, MAX_DIRECT_RECIPIENTS);
        sent += 1;
        emailed += directEmails.length;
      } catch (error) {
        await releaseRecipients(input, [...direct.claimed, ...claimedWatchers]);
        logger.warn({ incidentId: incident.id, error: error instanceof Error ? error.message : "send failed" }, "Incident email to participants failed");
      }
    }

    if (PEOPLE_ONLY_EVENTS.includes(input.event)) return attempted === 0 || sent > 0;
    if (input.event === "escalated" && !input.targets?.providerIds?.length) {
      const ok = attempted > 0 && sent > 0;
      if (ok) await recordPageTimeline(incident.id, input, [], emailed);
      else await releaseEvent(input, claim);
      return ok;
    }

    // Providers linked to the monitor/job that raised the alert; other incidents use the project policy.
    const [source] = await db
      .select({ sourceType: sreAlertEvents.sourceType, sourceId: sreAlertEvents.sourceId, dedupKey: sreAlertEvents.dedupKey })
      .from(sreIncidentAlerts)
      .innerJoin(sreAlertEvents, eq(sreAlertEvents.id, sreIncidentAlerts.alertEventId))
      .where(and(eq(sreIncidentAlerts.incidentId, incident.id), eq(sreIncidentAlerts.role, "trigger")))
      .limit(1);
    const fromMonitorOrJob = Boolean(source?.sourceId) && (source?.sourceType === "monitor" || source?.sourceType === "job");

    // One message per event: the worker already posted the alert (created) and the
    // recovery (automatic resolve, recovered) to these channels.
    // `created` is skipped only when the worker's alert was actually delivered; if every
    // delivery failed, the channels have not heard about it yet.
    // An automatic reopen from a new failure whose page reached nobody falls through to the fallback below.
    const reopenedByAlert = input.event === "reopened" && input.automatic === true && Boolean(input.triggerAlertHistoryId);
    if (input.event === "recovered" || (input.event === "reopened" && input.automatic && !reopenedByAlert) || (input.event === "resolved" && input.automatic)) {
      return attempted === 0 || sent > 0;
    }
    // `created` for a monitor or job whose own alert reached nobody: add the policy channels as a fallback.
    let addPolicyFallback = false;
    if (fromMonitorOrJob && (input.event === "created" || reopenedByAlert)) {
      if (await triggerAlertDelivered(source.sourceType as "monitor" | "job", source.sourceId as string, source.dedupKey, input.triggerAlertHistoryId)) {
        return attempted === 0 || sent > 0;
      }
      addPolicyFallback = true;
    }

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
    // Reminders and incidents without a monitor or job use the project's Default policy; escalation uses its one
    // target; a monitor's or job's own hand-picked channels are left as they were.
    const sourceProviders =
      input.event === "escalated"
        ? await listPolicyProviders(input.organizationId, input.projectId, input.targets?.providerIds ?? [])
        : !fromMonitorOrJob || input.event === "unacknowledged"
        ? await listPolicyProviders(input.organizationId, input.projectId, policy?.channelIds ?? [])
        : source.sourceType === "monitor"
          ? await db
              .select(providerColumns)
              .from(monitorNotificationSettings)
              .innerJoin(notificationProviders, eq(notificationProviders.id, monitorNotificationSettings.notificationProviderId))
              .where(and(eq(monitorNotificationSettings.monitorId, source.sourceId as string), providerScope))
              .limit(10)
          : await db
              .select(providerColumns)
              .from(jobNotificationSettings)
              .innerJoin(notificationProviders, eq(notificationProviders.id, jobNotificationSettings.notificationProviderId))
              .where(and(eq(jobNotificationSettings.jobId, source.sourceId as string), providerScope))
              .limit(10);
    const fallbackProviders = addPolicyFallback ? await listPolicyProviders(input.organizationId, input.projectId, policy?.channelIds ?? []) : [];
    const candidates = [...sourceProviders, ...fallbackProviders.filter((p) => !sourceProviders.some((s) => s.id === p.id))];

    // Provider configs are stored as encrypted envelopes bound to their project. Paging presets and templated
    // webhooks are dropped here: they are shaped for one receiver, and the worker already paged them.
    const providers = candidates.flatMap((provider) => {
      try {
        const config = decryptNotificationProviderConfig(provider.config, provider.projectId ?? undefined);
        return isPagingWebhook(provider.type, config as Record<string, unknown>) ? [] : [{ ...provider, config, broken: false }];
      } catch {
        return [{ ...provider, config: {} as PlainNotificationProviderConfig, broken: true }];
      }
    });
    attempted += providers.length;
    const delivered = await Promise.all(
      providers.map(async (provider) => {
        try {
          if (provider.broken) throw new Error("config unreadable");
          validateProviderConfig(provider.type, provider.config, "send");
          return await sendToProvider({ type: provider.type, config: provider.config }, message);
        } catch (error) {
          logger.warn({ providerId: provider.id, type: provider.type, error: error instanceof Error ? error.message : "send failed" }, "Incident notification delivery failed");
          return null;
        }
      }),
    );
    // null is a failed send; false is a provider that deliberately sends nothing.
    sent += delivered.filter((result) => result === true).length;
    const channelResults = providers.map((provider, index) => ({ providerId: provider.id, type: provider.type, ok: delivered[index] === true }));
    if (addPolicyFallback && input.report) input.report.fallback = fallbackProviders.length > 0 && channelResults.some((c) => c.ok && fallbackProviders.some((f) => f.id === c.providerId)) ? "policy_channels" : "none";
    // Keep the claim once anything went out (participant emails): a retry would email those people again.
    if (sent === 0 && delivered.length > 0 && !delivered.some((result) => result !== null)) await releaseEvent(input, claim);

    // Nobody owns it and nothing reached a channel: tell the project's owners and admins.
    // Also for the one re-notify, so it is never silently lost.
    if (input.event === "created" || input.event === "unacknowledged" || addPolicyFallback) {
      const reachedChannel = delivered.some((result) => result === true);
      const hasEligibleOwner = await ownerCanAct(input, [ownerId, incident.commanderUserId]);
      if (!reachedChannel && !hasEligibleOwner) {
        const admins = await listProjectAdmins(input.organizationId, input.projectId).catch(() => []);
        const emails = admins.filter((admin) => admin.id !== input.actorUserId).map((admin) => admin.email);
        if (emails.length > 0) {
          attempted += 1;
          await sendEmail(emails, message)
            .then(() => {
              sent += 1;
              emailed += emails.length;
              if (addPolicyFallback && input.report && input.report.fallback !== "policy_channels") input.report.fallback = "admins";
            })
            .catch((error: unknown) =>
              logger.warn({ incidentId: incident.id, error: error instanceof Error ? error.message : "send failed" }, "Incident email to project admins failed"),
            );
        }
      }
    }
    if (attempted > 0 && sent === 0) {
      await releaseEvent(input, claim);
      return false;
    }
    // A reminder or escalation that reached nobody (no channels, no one to email) is used up: the timeline says so.
    if (input.event === "unacknowledged" || input.event === "escalated") {
      if (input.event === "escalated" && attempted === 0) {
        await releaseEvent(input, claim);
        return false;
      }
      await recordPageTimeline(incident.id, input, channelResults, emailed);
    }
    return true;
  } catch (error) {
    logger.warn({ incidentId: input.incidentId, event: input.event, error: error instanceof Error ? error.message : "notify failed" }, "Incident notification skipped");
    // Release the claim so a retry (for example the re-notify sweep) is not deduped away.
    if (claim) await releaseEvent(input, claim).catch(() => undefined);
    return false;
  }
}

/** True when the owner or commander can still act on the incident (a removed or demoted person cannot). */
async function ownerCanAct(input: IncidentNotifyInput, ids: Array<string | null | undefined>) {
  try {
    const { isAssignableUser } = await import("./incident-lifecycle");
    for (const id of ids) {
      if (id && (await isAssignableUser(input.organizationId, input.projectId, id))) return true;
    }
  } catch {
    // A failed lookup counts as "someone can act": better silent than a wrongly broadcast mail.
    return true;
  }
  return false;
}

/** One timeline row per reminder or escalation sent: provider ids, types and outcomes only, never addresses or bodies. */
async function recordPageTimeline(
  incidentId: string,
  input: IncidentNotifyInput,
  channels: Array<{ providerId: string; type: string; ok: boolean }>,
  emailed: number,
) {
  const reached = channels.filter((channel) => channel.ok).length + (emailed > 0 ? 1 : 0);
  await db
    .insert(sreIncidentTimelineEvents)
    .values({
      incidentId,
      eventType: "notification",
      actorType: "system",
      eventData:
        input.event === "unacknowledged"
          ? { kind: "reminder", n: input.reminder?.n ?? 1, of: input.reminder?.of ?? 1, channels, emailed, reached }
          : { kind: "escalation", channels, emailed, reached },
    })
    .catch((error: unknown) => logger.warn({ incidentId, error: error instanceof Error ? error.message : "insert failed" }, "Incident notification timeline write failed"));
}
