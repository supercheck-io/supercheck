import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  incidentUpdates,
  incidents as statusPageIncidents,
  maintenanceWindows,
  maintenanceWindowTargets,
  statusPageNotificationEvents,
} from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger/index";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { resolveIncidentResources } from "@/lib/sre/incident-resources";
import { checkMaintenanceWriteRateLimit } from "@/lib/sre/sre-rate-limiter";
import { createStatusPageIncident, findStatusPageTargetError, type StatusPageIncidentActor } from "@/lib/status-page-incident-core";
import { db } from "@/utils/db";
import { occurrenceAtOrAfter, validateSchedule, type Occurrence, type WindowSchedule } from "./occurrence";

const logger = createLogger({ module: "maintenance-windows" }) as { error: (data: unknown, message?: string) => void };

/** Windows that are not completed or cancelled, per project; and targets per window (spec M11). */
export const MAX_LIVE_WINDOWS = 100;
export const MAX_WINDOW_TARGETS = 500;
const MINUTE = 60_000;

// Lowercase, as Postgres returns them.
const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const targetsSchema = z.object({
  serviceIds: z.array(uuid).max(MAX_WINDOW_TARGETS).default([]),
  monitorIds: z.array(uuid).max(MAX_WINDOW_TARGETS).default([]),
});
const scheduleFields = {
  recurrence: z.enum(["once", "daily", "weekly", "monthly"]),
  timezone: z.string().trim().min(1).max(64),
  localStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
  durationMinutes: z.number().int(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).nullish(),
  monthDay: z.number().int().nullish(),
};

export const windowInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).nullish(),
  scope: z.enum(["project", "services", "monitors"]),
  targets: targetsSchema.default({ serviceIds: [], monitorIds: [] }),
  ...scheduleFields,
  /** One-off windows only: post a scheduled maintenance to these pages. */
  statusPages: z.array(z.object({ statusPageId: uuid, componentIds: z.array(uuid).min(1).max(100) })).max(10).default([]),
  notifySubscribers: z.boolean().default(false),
});
export const windowUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  scope: z.enum(["project", "services", "monitors"]).optional(),
  targets: targetsSchema.optional(),
  ...Object.fromEntries(Object.entries(scheduleFields).map(([key, schema]) => [key, schema.optional()])) as {
    [K in keyof typeof scheduleFields]: z.ZodOptional<(typeof scheduleFields)[K]>;
  },
});
export const extendSchema = z.union([
  z.object({ byMinutes: z.number().int().min(1).max(7 * 24 * 60) }),
  z.object({ until: z.coerce.date() }),
]);

export type WindowState = "scheduled" | "active" | "completed" | "cancelled";
type WindowRow = typeof maintenanceWindows.$inferSelect;
export type MaintenanceWindowView = Omit<WindowRow, "localStartTime"> & {
  localStartTime: string;
  state: WindowState;
  targets: Array<{ type: "service" | "monitor"; id: string }>;
  statusPageIncidentIds: string[];
};

export type WindowResult<T> =
  | { ok: true } & T
  | { ok: false; code: "invalid"; error: string; fieldErrors?: Record<string, string> }
  | { ok: false; code: "forbidden" | "not_found" | "conflict"; error: string }
  | { ok: false; code: "rate_limited"; error: string; retryAfterSeconds: number };

export function windowState(row: Pick<WindowRow, "recurrence" | "cancelledAt" | "completedAt" | "occurrenceStartsAt" | "occurrenceEndsAt">, now = new Date()): WindowState {
  if (row.cancelledAt) return "cancelled";
  if (row.completedAt) return "completed";
  if (row.occurrenceStartsAt && row.occurrenceEndsAt && row.occurrenceStartsAt <= now && row.occurrenceEndsAt > now) return "active";
  // A series between an occurrence's end and the advance tick is still live: its next occurrence is coming.
  if (row.recurrence === "once" && row.occurrenceEndsAt && row.occurrenceEndsAt <= now) return "completed";
  return "scheduled";
}

/** SQL for one state, matching windowState; the advance tick keeps stored rows close to it. */
function stateFilter(state: "active" | "scheduled" | "past", now: Date): SQL {
  const live = and(isNull(maintenanceWindows.cancelledAt), isNull(maintenanceWindows.completedAt));
  if (state === "active") return and(live, lte(maintenanceWindows.occurrenceStartsAt, now), gt(maintenanceWindows.occurrenceEndsAt, now))!;
  const once = eq(maintenanceWindows.recurrence, "once");
  if (state === "scheduled") return and(live, or(gt(maintenanceWindows.occurrenceStartsAt, now), and(ne(maintenanceWindows.recurrence, "once"), lte(maintenanceWindows.occurrenceEndsAt, now))))!;
  return or(isNotNull(maintenanceWindows.cancelledAt), isNotNull(maintenanceWindows.completedAt), and(once, lte(maintenanceWindows.occurrenceEndsAt, now)))!;
}

const scheduleOf = (row: Pick<WindowRow, "recurrence" | "timezone" | "localStartTime" | "durationMinutes" | "startsOn" | "endsOn" | "weekdays" | "monthDay">): WindowSchedule => ({
  recurrence: row.recurrence,
  timezone: row.timezone,
  localStartTime: row.localStartTime.slice(0, 5),
  durationMinutes: row.durationMinutes,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  weekdays: row.weekdays,
  monthDay: row.monthDay,
});

export type WindowSource = "ui" | "api" | "cli" | "mcp";

function can(actor: StatusPageIncidentActor, resource: "monitor" | "status_page", action: string) {
  return checkPermissionWithContext(resource, action, actor);
}

async function limited(actor: StatusPageIncidentActor): Promise<WindowResult<object> | null> {
  const limit = await checkMaintenanceWriteRateLimit(actor.userId);
  if (limit.allowed) return null;
  return { ok: false, code: "rate_limited", error: "Too many maintenance changes. Try again shortly.", retryAfterSeconds: limit.resetTime ? Math.max(1, Math.ceil((limit.resetTime - Date.now()) / 1000)) : 60 };
}

function audit(actor: StatusPageIncidentActor, action: string, windowId: string, metadata: Record<string, unknown> = {}) {
  return logAuditEvent({
    userId: actor.userId,
    organizationId: actor.organizationId,
    action,
    resource: "maintenance_window",
    resourceId: windowId,
    metadata: { projectId: actor.project.id, ...metadata },
    success: true,
  });
}

/** Targets must be services or monitors of the window's project. */
async function resolveTargets(actor: StatusPageIncidentActor, scope: string, targets: z.output<typeof targetsSchema>) {
  if (scope === "project") return [];
  const ids = scope === "services" ? { serviceIds: targets.serviceIds, monitorIds: [] } : { serviceIds: [], monitorIds: targets.monitorIds };
  if (ids.serviceIds.length + ids.monitorIds.length === 0) return null;
  return resolveIncidentResources(db, { organizationId: actor.organizationId, projectId: actor.project.id }, ids);
}

function scopedWindow(actor: StatusPageIncidentActor, id: string) {
  return and(eq(maintenanceWindows.id, id), eq(maintenanceWindows.organizationId, actor.organizationId), eq(maintenanceWindows.projectId, actor.project.id));
}

async function toViews(rows: WindowRow[], now = new Date()): Promise<MaintenanceWindowView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [targets, pages] = await Promise.all([
    db.select({ windowId: maintenanceWindowTargets.windowId, type: maintenanceWindowTargets.targetType, id: maintenanceWindowTargets.targetId })
      .from(maintenanceWindowTargets).where(inArray(maintenanceWindowTargets.windowId, ids)),
    db.select({ windowId: statusPageIncidents.maintenanceWindowId, id: statusPageIncidents.id })
      .from(statusPageIncidents).where(inArray(statusPageIncidents.maintenanceWindowId, ids)),
  ]);
  return rows.map((row) => ({
    ...row,
    localStartTime: row.localStartTime.slice(0, 5),
    state: windowState(row, now),
    targets: targets.filter((t) => t.windowId === row.id).map(({ type, id }) => ({ type, id })),
    statusPageIncidentIds: pages.filter((p) => p.windowId === row.id).map((p) => p.id),
  }));
}

export async function listMaintenanceWindows(
  actor: StatusPageIncidentActor,
  filters: { state?: "active" | "scheduled" | "past"; monitorId?: string; serviceId?: string } = {},
): Promise<WindowResult<{ windows: MaintenanceWindowView[] }>> {
  if (!can(actor, "monitor", "view")) return { ok: false, code: "forbidden", error: "Insufficient permissions to view maintenance windows" };
  const now = new Date();
  const where = [eq(maintenanceWindows.organizationId, actor.organizationId), eq(maintenanceWindows.projectId, actor.project.id)];
  if (filters.state) where.push(stateFilter(filters.state, now));
  if (filters.monitorId) {
    // Windows that cover the monitor: project scope, the monitor itself, a service it is mapped to, or a status-page component.
    where.push(sql`(${maintenanceWindows.scope} = 'project' OR EXISTS (
      SELECT 1 FROM maintenance_window_targets t WHERE t.window_id = ${maintenanceWindows.id} AND (
        (t.target_type = 'monitor' AND t.target_id = ${filters.monitorId}::uuid)
        OR (t.target_type = 'service' AND EXISTS (SELECT 1 FROM sre_service_resources r WHERE r.service_id = t.target_id AND r.resource_type = 'monitor' AND r.resource_id = ${filters.monitorId}::uuid))
      ))
      -- Its live status-page post also mutes the monitors behind the post's components.
      OR EXISTS (SELECT 1 FROM incidents i
        JOIN incident_components ic ON ic.incident_id = i.id
        JOIN status_page_component_monitors scm ON scm.component_id = ic.component_id
        WHERE i.maintenance_window_id = ${maintenanceWindows.id} AND i.status <> 'resolved' AND scm.monitor_id = ${filters.monitorId}::uuid))`);
  }
  if (filters.serviceId) {
    where.push(sql`(${maintenanceWindows.scope} = 'project' OR EXISTS (
      SELECT 1 FROM maintenance_window_targets t WHERE t.window_id = ${maintenanceWindows.id} AND t.target_type = 'service' AND t.target_id = ${filters.serviceId}::uuid))`);
  }
  const rows = await db.select().from(maintenanceWindows).where(and(...where))
    // Unfiltered, live windows sort first so a long history never hides them behind the 200-row limit.
    .orderBy(...(filters.state === "past"
      ? [desc(maintenanceWindows.occurrenceEndsAt)]
      : [sql`(${maintenanceWindows.cancelledAt} IS NULL AND ${maintenanceWindows.completedAt} IS NULL) DESC`, asc(maintenanceWindows.occurrenceStartsAt)]))
    .limit(200);
  return { ok: true, windows: await toViews(rows, now) };
}

export async function getMaintenanceWindow(actor: StatusPageIncidentActor, id: string): Promise<WindowResult<{ window: MaintenanceWindowView }>> {
  if (!can(actor, "monitor", "view")) return { ok: false, code: "forbidden", error: "Insufficient permissions to view maintenance windows" };
  const [row] = await db.select().from(maintenanceWindows).where(scopedWindow(actor, id)).limit(1);
  if (!row) return { ok: false, code: "not_found", error: "Maintenance window not found" };
  return { ok: true, window: (await toViews([row]))[0]! };
}

export async function createMaintenanceWindow(
  actor: StatusPageIncidentActor,
  input: z.input<typeof windowInputSchema>,
  source: WindowSource,
): Promise<WindowResult<{ window: MaintenanceWindowView; warning?: "status_page_failed" }>> {
  const parsed = windowInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: parsed.error.issues[0]?.message ?? "Invalid maintenance window" };
  const data = parsed.data;
  if (!can(actor, "monitor", "update") || (data.statusPages.length > 0 && !can(actor, "status_page", "update"))) {
    return { ok: false, code: "forbidden", error: "Insufficient permissions to schedule maintenance" };
  }
  const schedule: WindowSchedule = { ...data, weekdays: data.recurrence === "weekly" ? data.weekdays : null, monthDay: data.recurrence === "monthly" ? data.monthDay : null };
  const fieldErrors = validateSchedule(schedule);
  if (Object.keys(fieldErrors).length) return { ok: false, code: "invalid", error: Object.values(fieldErrors)[0]!, fieldErrors };
  if (data.statusPages.length > 0 && data.recurrence !== "once") {
    return { ok: false, code: "invalid", error: "Only one-off windows can be posted to a status page" };
  }
  const now = new Date();
  const occurrence = occurrenceAtOrAfter(schedule, now);
  if (!occurrence) return { ok: false, code: "invalid", error: "This schedule has no occurrence in the future" };
  const rateLimited = await limited(actor);
  if (rateLimited) return rateLimited as WindowResult<never>;

  const targets = await resolveTargets(actor, data.scope, data.targets);
  if (!targets) return { ok: false, code: data.scope === "project" ? "invalid" : "not_found", error: "Pick at least one service or monitor in this project" };
  for (const page of data.statusPages) {
    const error = await findStatusPageTargetError({ organizationId: actor.organizationId, projectId: actor.project.id }, page.statusPageId, page.componentIds);
    if (error) return { ok: false, code: "not_found", error };
  }

  const created = await db.transaction(async (tx) => {
    // Serialises creates per project so the cap holds.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`maintenance:${actor.project.id}`}))`);
    const [live] = await tx.select({ n: count() }).from(maintenanceWindows).where(and(
      eq(maintenanceWindows.projectId, actor.project.id), isNull(maintenanceWindows.cancelledAt), isNull(maintenanceWindows.completedAt),
    ));
    if (Number(live?.n ?? 0) >= MAX_LIVE_WINDOWS) return null;
    const [row] = await tx.insert(maintenanceWindows).values({
      organizationId: actor.organizationId,
      projectId: actor.project.id,
      title: data.title,
      description: data.description || null,
      scope: data.scope,
      recurrence: data.recurrence,
      timezone: data.timezone,
      localStartTime: data.localStartTime,
      durationMinutes: data.durationMinutes,
      startsOn: data.startsOn,
      endsOn: data.endsOn ?? null,
      weekdays: schedule.weekdays ?? null,
      monthDay: schedule.monthDay ?? null,
      occurrenceStartsAt: occurrence.startsAt,
      occurrenceEndsAt: occurrence.endsAt,
      createdByUserId: actor.userId,
    }).returning();
    if (targets.length) {
      await tx.insert(maintenanceWindowTargets).values(targets.map((target) => ({ windowId: row!.id, targetType: target.type, targetId: target.id })));
    }
    return row!;
  });
  if (!created) return { ok: false, code: "conflict", error: `A project can have at most ${MAX_LIVE_WINDOWS} upcoming or active windows` };

  // Published after the window exists; a failed post keeps the window (it mutes alerts either way).
  let warning: "status_page_failed" | undefined;
  for (const page of data.statusPages) {
    const posted = await createStatusPageIncident(actor, {
      statusPageId: page.statusPageId,
      name: data.title.slice(0, 255),
      status: "scheduled",
      scheduledFor: occurrence.startsAt,
      scheduledUntil: occurrence.endsAt,
      impact: "minor",
      body: data.description || undefined,
      affectedComponentIds: page.componentIds,
      componentStatus: "under_maintenance",
      deliverNotifications: data.notifySubscribers,
    }).catch((error: unknown) => {
      logger.error({ error, windowId: created.id }, "Posting a maintenance window to a status page failed");
      return { success: false as const, message: "failed" };
    });
    if (!posted.success) {
      warning = "status_page_failed";
      continue;
    }
    // Someone may have cancelled, ended or rescheduled the window while the post was being created: link the
    // post only to the window as it was published, under its row lock; otherwise take the stale post down.
    const linked = await db.transaction(async (tx) => {
      const [live] = await tx.select({ id: maintenanceWindows.id }).from(maintenanceWindows).where(and(
        eq(maintenanceWindows.id, created.id),
        isNull(maintenanceWindows.cancelledAt),
        isNull(maintenanceWindows.completedAt),
        eq(maintenanceWindows.occurrenceStartsAt, occurrence.startsAt),
        eq(maintenanceWindows.occurrenceEndsAt, occurrence.endsAt),
      )).for("update");
      const now = new Date();
      await tx.update(statusPageIncidents)
        .set(live ? { maintenanceWindowId: created.id } : { maintenanceWindowId: created.id, status: "resolved", resolvedAt: now, updatedAt: now })
        .where(eq(statusPageIncidents.id, posted.incident.id));
      return Boolean(live);
    });
    if (!linked) warning = "status_page_failed";
  }
  await audit(actor, "maintenance_window_created", created.id, { source, scope: data.scope, recurrence: data.recurrence, targets: targets.length, statusPages: data.statusPages.length });
  return { ok: true, window: (await toViews([created]))[0]!, ...(warning ? { warning } : {}) };
}

async function loadForWrite(actor: StatusPageIncidentActor, id: string, permission: "update" | "delete", source: WindowSource) {
  if (!z.string().uuid().safeParse(id).success) return { error: { ok: false as const, code: "invalid" as const, error: "Invalid maintenance window" } };
  if (!can(actor, "monitor", permission)) return { error: { ok: false as const, code: "forbidden" as const, error: "Insufficient permissions to change maintenance windows" } };
  const rateLimited = await limited(actor);
  if (rateLimited) return { error: rateLimited as WindowResult<never> };
  const [row] = await db.select().from(maintenanceWindows).where(scopedWindow(actor, id)).limit(1);
  if (!row) return { error: { ok: false as const, code: "not_found" as const, error: "Maintenance window not found" } };
  // A change to a window that is still on a status page also changes that public post.
  const [onStatusPage] = await db.select({ id: statusPageIncidents.id }).from(statusPageIncidents)
    .where(and(eq(statusPageIncidents.maintenanceWindowId, row.id), sql`${statusPageIncidents.status} <> 'resolved'`)).limit(1);
  if (onStatusPage) {
    if (permission === "delete") return { error: { ok: false as const, code: "conflict" as const, error: "This window is on a status page. Cancel it first." } };
    if (source === "mcp") return { error: { ok: false as const, code: "conflict" as const, error: "This window is on a status page. Change it in Supercheck, not through MCP." } };
    if (!can(actor, "status_page", "update")) return { error: { ok: false as const, code: "forbidden" as const, error: "Insufficient permissions to change the status page post" } };
  }
  return { row, onStatusPage: Boolean(onStatusPage) };
}

const ADVANCE_GRACE_MS = 10 * MINUTE;

/**
 * The row is still live and unchanged since it was read: every write bumps updated_at, so a concurrent tick,
 * edit or delete makes this match nothing. Compared at millisecond precision, the precision the row was read at.
 */
function unchanged(row: WindowRow) {
  return and(
    eq(maintenanceWindows.id, row.id),
    isNull(maintenanceWindows.cancelledAt),
    isNull(maintenanceWindows.completedAt),
    sql`date_trunc('milliseconds', ${maintenanceWindows.updatedAt}) = ${row.updatedAt.toISOString()}::timestamptz`,
  );
}

const CHANGED = { ok: false as const, code: "conflict" as const, error: "The window changed meanwhile. Reload and try again." };

/** Moves linked scheduled status-page incidents to a new end; the status-page reconciler completes them with their notices. */
async function moveLinkedEnd(tx: Pick<typeof db, "update">, windowId: string, until: Date) {
  await tx.update(statusPageIncidents)
    .set({ scheduledUntil: until, updatedAt: new Date() })
    .where(and(eq(statusPageIncidents.maintenanceWindowId, windowId), sql`${statusPageIncidents.status} <> 'resolved'`));
}

export async function updateMaintenanceWindow(
  actor: StatusPageIncidentActor,
  id: string,
  input: z.input<typeof windowUpdateSchema>,
  source: WindowSource = "api",
): Promise<WindowResult<{ window: MaintenanceWindowView }>> {
  const parsed = windowUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: parsed.error.issues[0]?.message ?? "Invalid maintenance window" };
  const loaded = await loadForWrite(actor, id, "update", source);
  if ("error" in loaded) return loaded.error!;
  const { row } = loaded;
  const now = new Date();
  const state = windowState(row, now);
  if (state === "completed" || state === "cancelled") return { ok: false, code: "conflict", error: "This window is over and cannot be edited" };
  const data = parsed.data;
  const scheduleEdit = Object.keys(scheduleFields).some((key) => data[key as keyof typeof data] !== undefined);
  if (state === "active" && row.recurrence === "once" && scheduleEdit) return { ok: false, code: "conflict", error: "This window is in progress. End or extend it instead of changing its schedule." };
  const merged: WindowSchedule = { ...scheduleOf(row), ...Object.fromEntries(Object.entries(data).filter(([key, value]) => key in scheduleFields && value !== undefined)) };
  merged.weekdays = merged.recurrence === "weekly" ? merged.weekdays : null;
  merged.monthDay = merged.recurrence === "monthly" ? merged.monthDay : null;
  const fieldErrors = validateSchedule(merged);
  if (Object.keys(fieldErrors).length) return { ok: false, code: "invalid", error: Object.values(fieldErrors)[0]!, fieldErrors };
  if (merged.recurrence !== "once" && loaded.onStatusPage) return { ok: false, code: "invalid", error: "A window on a status page must stay one-off. Cancel it and schedule a recurring one." };
  const scope = data.scope ?? row.scope;
  const targets = data.targets || data.scope ? await resolveTargets(actor, scope, data.targets ?? { serviceIds: [], monitorIds: [] }) : undefined;
  if (targets === null) return { ok: false, code: "not_found", error: "Pick at least one service or monitor in this project" };

  // Edits apply to future occurrences only: an active occurrence keeps its times.
  const occurrence: Occurrence | null = state === "active" ? { startsAt: row.occurrenceStartsAt!, endsAt: row.occurrenceEndsAt! } : occurrenceAtOrAfter(merged, now);
  if (!occurrence) return { ok: false, code: "invalid", error: "This schedule has no occurrence in the future" };
  const [updated] = await db.transaction(async (tx) => {
    const [claimed] = await tx.update(maintenanceWindows).set({ updatedAt: now }).where(unchanged(row)).returning({ id: maintenanceWindows.id });
    if (!claimed) return [];
    if (targets !== undefined) {
      await tx.delete(maintenanceWindowTargets).where(eq(maintenanceWindowTargets.windowId, row.id));
      if (targets.length) await tx.insert(maintenanceWindowTargets).values(targets.map((t) => ({ windowId: row.id, targetType: t.type, targetId: t.id })));
    }
    if (state !== "active") {
      await tx.update(statusPageIncidents).set({ scheduledFor: occurrence.startsAt, scheduledUntil: occurrence.endsAt, updatedAt: now })
        .where(and(eq(statusPageIncidents.maintenanceWindowId, row.id), eq(statusPageIncidents.status, "scheduled")));
    }
    return tx.update(maintenanceWindows).set({
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description || null } : {}),
      scope,
      recurrence: merged.recurrence,
      timezone: merged.timezone,
      localStartTime: merged.localStartTime,
      durationMinutes: merged.durationMinutes,
      startsOn: merged.startsOn,
      endsOn: merged.endsOn ?? null,
      weekdays: merged.weekdays ?? null,
      monthDay: merged.monthDay ?? null,
      occurrenceStartsAt: occurrence.startsAt,
      occurrenceEndsAt: occurrence.endsAt,
      updatedAt: now,
    }).where(eq(maintenanceWindows.id, row.id)).returning();
  });
  if (!updated) return CHANGED;
  await audit(actor, "maintenance_window_updated", row.id, {
    source,
    changed: Object.keys(data).filter((key) => data[key as keyof typeof data] !== undefined),
    ...(targets !== undefined ? { scopeBefore: row.scope, scope, targets: targets.length } : {}),
  });
  return { ok: true, window: (await toViews([updated!]))[0]! };
}

/** Ends the active occurrence now: a one-off completes, a series moves to its next occurrence. */
export async function endMaintenanceWindow(actor: StatusPageIncidentActor, id: string, source: WindowSource = "api"): Promise<WindowResult<{ window: MaintenanceWindowView }>> {
  const loaded = await loadForWrite(actor, id, "update", source);
  if ("error" in loaded) return loaded.error!;
  const { row } = loaded;
  const now = new Date();
  if (windowState(row, now) !== "active") return { ok: false, code: "conflict", error: "Only an active window can be ended" };
  const next = row.recurrence === "once" ? null : occurrenceAtOrAfter(scheduleOf(row), row.occurrenceEndsAt!);
  const [updated] = await db.transaction(async (tx) => {
    const done = await tx.update(maintenanceWindows).set(
      next
        ? { occurrenceStartsAt: next.startsAt, occurrenceEndsAt: next.endsAt, updatedAt: now }
        : { occurrenceEndsAt: now, completedAt: now, updatedAt: now },
    ).where(unchanged(row)).returning();
    if (done.length) await moveLinkedEnd(tx, row.id, now);
    return done;
  });
  if (!updated) return CHANGED;
  await audit(actor, "maintenance_window_ended", row.id, { source });
  return { ok: true, window: (await toViews([updated!]))[0]! };
}

export async function extendMaintenanceWindow(
  actor: StatusPageIncidentActor,
  id: string,
  input: z.input<typeof extendSchema>,
  source: WindowSource = "api",
): Promise<WindowResult<{ window: MaintenanceWindowView }>> {
  const parsed = extendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Pass byMinutes or until" };
  const loaded = await loadForWrite(actor, id, "update", source);
  if ("error" in loaded) return loaded.error!;
  const { row } = loaded;
  const now = new Date();
  if (windowState(row, now) !== "active") return { ok: false, code: "conflict", error: "Only an active window can be extended" };
  const until = "until" in parsed.data ? parsed.data.until : new Date(row.occurrenceEndsAt!.getTime() + parsed.data.byMinutes * MINUTE);
  if (until <= now) return { ok: false, code: "invalid", error: "The new end must be in the future" };
  if (until.getTime() - row.occurrenceStartsAt!.getTime() > 7 * 24 * 60 * MINUTE) return { ok: false, code: "invalid", error: "A window can last at most 7 days" };
  if (row.recurrence !== "once") {
    const next = occurrenceAtOrAfter(scheduleOf(row), row.occurrenceEndsAt!);
    if (next && until > next.startsAt) return { ok: false, code: "invalid", error: "The new end runs into the next occurrence" };
  }
  const [updated] = await db.transaction(async (tx) => {
    const done = await tx.update(maintenanceWindows).set({ occurrenceEndsAt: until, updatedAt: now }).where(unchanged(row)).returning();
    if (done.length) await moveLinkedEnd(tx, row.id, until);
    return done;
  });
  if (!updated) return CHANGED;
  await audit(actor, "maintenance_window_extended", row.id, { source, until: until.toISOString() });
  return { ok: true, window: (await toViews([updated!]))[0]! };
}

/**
 * Cancels a scheduled one-off or the rest of a series. A published status-page maintenance has no cancelled state,
 * so it is resolved with "This maintenance was cancelled"; subscribers hear about it only if they were told at creation.
 */
export async function cancelMaintenanceWindow(actor: StatusPageIncidentActor, id: string, source: WindowSource = "api"): Promise<WindowResult<{ window: MaintenanceWindowView }>> {
  const loaded = await loadForWrite(actor, id, "update", source);
  if ("error" in loaded) return loaded.error!;
  const { row } = loaded;
  const now = new Date();
  const state = windowState(row, now);
  if (state === "completed" || state === "cancelled") return { ok: false, code: "conflict", error: "This window is already over" };
  if (state === "active" && row.recurrence === "once") return { ok: false, code: "conflict", error: "End an active window instead of cancelling it" };
  const [updated] = await db.transaction(async (tx) => {
    const [claimed] = await tx.update(maintenanceWindows).set({ updatedAt: now }).where(unchanged(row)).returning({ id: maintenanceWindows.id });
    if (!claimed) return [];
    const linked = await tx.select({ id: statusPageIncidents.id, deliver: statusPageIncidents.deliverNotifications })
      .from(statusPageIncidents)
      .where(and(eq(statusPageIncidents.maintenanceWindowId, row.id), sql`${statusPageIncidents.status} <> 'resolved'`));
    for (const incident of linked) {
      await tx.update(statusPageIncidents).set({ status: "resolved", resolvedAt: now, updatedAt: now }).where(eq(statusPageIncidents.id, incident.id));
      const [update] = await tx.insert(incidentUpdates).values({
        incidentId: incident.id,
        createdByUserId: actor.userId,
        body: "This maintenance was cancelled.",
        status: "resolved",
        deliverNotifications: incident.deliver === true,
        displayAt: now,
      }).returning();
      if (incident.deliver === true) await tx.insert(statusPageNotificationEvents).values({ incidentId: incident.id, updateId: update!.id });
    }
    return tx.update(maintenanceWindows).set({
      cancelledAt: now,
      // An active occurrence of a series stops now, so nothing stays muted.
      ...(state === "active" ? { occurrenceEndsAt: now } : {}),
      updatedAt: now,
    }).where(eq(maintenanceWindows.id, row.id)).returning();
  });
  if (!updated) return CHANGED;
  await audit(actor, "maintenance_window_cancelled", row.id, { source });
  return { ok: true, window: (await toViews([updated!]))[0]! };
}

export async function deleteMaintenanceWindow(actor: StatusPageIncidentActor, id: string, source: WindowSource = "api"): Promise<WindowResult<object>> {
  const loaded = await loadForWrite(actor, id, "delete", source);
  if ("error" in loaded) return loaded.error!;
  const { row } = loaded;
  if (windowState(row) === "active") return { ok: false, code: "conflict", error: "End the window before deleting it" };
  await db.delete(maintenanceWindows).where(eq(maintenanceWindows.id, row.id));
  await audit(actor, "maintenance_window_deleted", row.id, { source });
  return { ok: true };
}

/**
 * Tick: moves each live window whose occurrence is over to its next one, or completes it. The worker never mutes
 * past occurrence_ends_at, so a missed tick only delays the next occurrence (fails open, toward alerting).
 */
export async function advanceMaintenanceWindows(now = new Date()): Promise<number> {
  // A result checked just before the end can be saved minutes later; it still matches the stored occurrence
  // until the tick moves on, so the tick waits a grace period (schedules keep 2 hours between occurrences).
  const due = await db.select().from(maintenanceWindows).where(and(
    isNull(maintenanceWindows.cancelledAt),
    isNull(maintenanceWindows.completedAt),
    or(lte(maintenanceWindows.occurrenceEndsAt, new Date(now.getTime() - ADVANCE_GRACE_MS)), isNull(maintenanceWindows.occurrenceEndsAt)),
  )).limit(500);
  for (const row of due) {
    const next = row.recurrence === "once" ? null : occurrenceAtOrAfter(scheduleOf(row), row.occurrenceEndsAt && row.occurrenceEndsAt > now ? row.occurrenceEndsAt : now);
    await db.update(maintenanceWindows).set(
      next ? { occurrenceStartsAt: next.startsAt, occurrenceEndsAt: next.endsAt, updatedAt: now } : { completedAt: now, updatedAt: now },
    ).where(unchanged(row));
  }
  return due.length;
}
