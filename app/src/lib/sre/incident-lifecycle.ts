import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import {
  alertHistory,
  member,
  projectMembers,
  sreAlertEvents,
  sreIncidentAlerts,
  sreIncidentTimelineEvents,
  sreIncidents,
  sreServiceOwners,
  sreServices,
  user,
  type AlertType,
} from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { isUuid } from "@/lib/uuid";
import { db } from "@/utils/db";

import {
  notifyIncidentEvent,
  type IncidentNotifyEvent,
} from "./incident-notifier";

export const MAX_RESOLUTION_SUMMARY_LENGTH = 2000;
export const MAX_INCIDENT_UPDATE_LENGTH = 2000;

type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

export type IncidentActor = {
  organizationId: string;
  projectId: string;
  userId: string;
};

export type LifecycleFailure = {
  ok: false;
  code: "not_found" | "invalid" | "conflict";
  error: string;
};

export type LifecycleResult<T extends object = object> =
  | ({ ok: true } & T)
  | LifecycleFailure;

type IncidentRef = { id: string; incidentNumber: number; title: string };

const ORG_WIDE_ROLES = ["org_owner", "org_admin"];
const PROJECT_WRITE_ROLES = ["project_admin", "project_editor"];

/**
 * Users who may be given an incident: org owners/admins (all projects) and
 * project admins/editors of this project. Viewers cannot act on incidents.
 */
export async function listAssignableUsers(
  organizationId: string,
  projectId: string,
  executor: Executor = db,
  onlyUserId?: string,
) {
  const rows = await executor
    .select({
      id: user.id,
      name: user.name,
      image: user.image,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      projectMembers,
      and(
        eq(projectMembers.userId, member.userId),
        eq(projectMembers.projectId, projectId),
      ),
    )
    .where(
      and(
        eq(member.organizationId, organizationId),
        onlyUserId ? eq(member.userId, onlyUserId) : undefined,
        or(
          inArray(member.role, ORG_WIDE_ROLES),
          inArray(projectMembers.role, PROJECT_WRITE_ROLES),
        ),
      ),
    )
    .orderBy(asc(user.name))
    .limit(200);
  return rows;
}

export async function isAssignableUser(
  organizationId: string,
  projectId: string,
  userId: string,
  executor: Executor = db,
) {
  if (!isUuid(userId)) return false;
  const rows = await listAssignableUsers(
    organizationId,
    projectId,
    executor,
    userId,
  );
  return rows.length > 0;
}

/**
 * Default owner for a new incident: the service's owner user, then its primary
 * user-type owner. Returns null (unassigned) when none is a current assignable member.
 */
export async function getDefaultAssigneeId(
  executor: Executor,
  input: { organizationId: string; projectId: string; serviceId: string | null },
): Promise<string | null> {
  if (!input.serviceId) return null;
  const [service] = await executor
    .select({ ownerUserId: sreServices.ownerUserId })
    .from(sreServices)
    .where(
      and(
        eq(sreServices.id, input.serviceId),
        eq(sreServices.organizationId, input.organizationId),
        eq(sreServices.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!service) return null;

  const candidates: string[] = [];
  if (service.ownerUserId) candidates.push(service.ownerUserId);
  const owners = await executor
    .select({ ownerRef: sreServiceOwners.ownerRef })
    .from(sreServiceOwners)
    .where(
      and(
        eq(sreServiceOwners.serviceId, input.serviceId),
        eq(sreServiceOwners.ownerType, "user"),
        eq(sreServiceOwners.role, "primary"),
      ),
    )
    .orderBy(asc(sreServiceOwners.createdAt))
    .limit(5);
  for (const owner of owners) {
    if (isUuid(owner.ownerRef)) candidates.push(owner.ownerRef);
  }

  for (const candidate of candidates) {
    if (
      await isAssignableUser(
        input.organizationId,
        input.projectId,
        candidate,
        executor,
      )
    ) {
      return candidate;
    }
  }
  return null;
}

function scope(actor: IncidentActor, incidentId: string) {
  return and(
    eq(sreIncidents.id, incidentId),
    eq(sreIncidents.organizationId, actor.organizationId),
    eq(sreIncidents.projectId, actor.projectId),
  );
}

async function audit(
  actor: IncidentActor,
  action: string,
  incident: IncidentRef,
  metadata: Record<string, unknown>,
) {
  await logAuditEvent({
    userId: actor.userId,
    organizationId: actor.organizationId,
    action,
    resource: "sre_incident",
    resourceId: incident.id,
    metadata: {
      projectId: actor.projectId,
      incidentNumber: incident.incidentNumber,
      ...metadata,
    },
    success: true,
  });
}

function notify(
  actor: IncidentActor,
  incidentId: string,
  event: IncidentNotifyEvent,
  extra: { assigneeUserId?: string | null } = {},
) {
  // Never let a delivery problem fail the user action; the notifier logs its own errors.
  void notifyIncidentEvent({
    organizationId: actor.organizationId,
    projectId: actor.projectId,
    incidentId,
    event,
    actorUserId: actor.userId,
    // The guarded UPDATE already makes each transition fire once; this keeps a later, distinct repeat (reopen then resolve) from being suppressed.
    dedupeDiscriminator: String(Date.now()),
    ...extra,
  }).catch(() => undefined);
}

export async function assignIncident(
  actor: IncidentActor,
  incidentId: string,
  assigneeUserId: string | null,
  role: "assignee" | "commander" = "assignee",
): Promise<LifecycleResult<{ incident: IncidentRef; changed: boolean }>> {
  const column = role === "commander" ? sreIncidents.commanderUserId : sreIncidents.assigneeUserId;
  const field = role === "commander" ? "commanderUserId" : "assigneeUserId";
  if (assigneeUserId !== null && !isUuid(assigneeUserId)) {
    return { ok: false, code: "invalid", error: "Select a valid assignee" };
  }
  if (
    assigneeUserId &&
    !(await isAssignableUser(
      actor.organizationId,
      actor.projectId,
      assigneeUserId,
    ))
  ) {
    return {
      ok: false,
      code: "invalid",
      error: "Assignee must be an editor or admin of this project",
    };
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ current: column })
      .from(sreIncidents)
      .where(scope(actor, incidentId))
      .limit(1);
    if (!before) return null;

    const [updated] = await tx
      .update(sreIncidents)
      .set({ [field]: assigneeUserId, updatedAt: now })
      .where(
        and(
          scope(actor, incidentId),
          sql`${column} IS DISTINCT FROM ${assigneeUserId}`,
        ),
      )
      .returning({
        id: sreIncidents.id,
        incidentNumber: sreIncidents.incidentNumber,
        title: sreIncidents.title,
      });
    if (!updated) {
      const [current] = await tx
        .select({
          id: sreIncidents.id,
          incidentNumber: sreIncidents.incidentNumber,
          title: sreIncidents.title,
        })
        .from(sreIncidents)
        .where(scope(actor, incidentId))
        .limit(1);
      return { incident: current, changed: false, previous: before.current };
    }

    await tx.insert(sreIncidentTimelineEvents).values({
      incidentId,
      eventType: "state_change",
      eventData: {
        state: role === "commander" ? "commander_changed" : "assigned",
        previousAssigneeUserId: before.current,
        assigneeUserId,
      },
      actorType: "user",
      actorUserId: actor.userId,
      createdAt: now,
    });
    return { incident: updated, changed: true, previous: before.current };
  });
  if (!result) {
    return { ok: false, code: "not_found", error: "Incident not found or access denied" };
  }

  if (result.changed) {
    await audit(actor, role === "commander" ? "sre_incident_commander_set" : "sre_incident_assigned", result.incident, {
      assigneeUserId,
      previousAssigneeUserId: result.previous,
    });
    if (assigneeUserId && role === "assignee") {
      notify(actor, incidentId, "assigned", { assigneeUserId });
    }
  }
  return { ok: true, incident: result.incident, changed: result.changed };
}

export async function acknowledgeIncident(
  actor: IncidentActor,
  incidentId: string,
): Promise<
  LifecycleResult<{ incident: IncidentRef; changed: boolean; autoAssigned: boolean }>
> {
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    // Guarded update: only the first acknowledgement of an unresolved incident stamps it.
    const [updated] = await tx
      .update(sreIncidents)
      .set({
        acknowledgedAt: now,
        acknowledgedByUserId: actor.userId,
        assigneeUserId: sql`coalesce(${sreIncidents.assigneeUserId}, ${actor.userId}::uuid)`,
        updatedAt: now,
      })
      .where(
        and(
          scope(actor, incidentId),
          isNull(sreIncidents.acknowledgedAt),
          ne(sreIncidents.status, "resolved"),
        ),
      )
      .returning({
        id: sreIncidents.id,
        incidentNumber: sreIncidents.incidentNumber,
        title: sreIncidents.title,
        assigneeUserId: sreIncidents.assigneeUserId,
      });

    if (!updated) {
      const [existing] = await tx
        .select({
          id: sreIncidents.id,
          incidentNumber: sreIncidents.incidentNumber,
          title: sreIncidents.title,
          status: sreIncidents.status,
          acknowledgedAt: sreIncidents.acknowledgedAt,
        })
        .from(sreIncidents)
        .where(scope(actor, incidentId))
        .limit(1);
      return existing ? { existing, updated: null } : null;
    }

    await tx.insert(sreIncidentTimelineEvents).values({
      incidentId,
      eventType: "state_change",
      eventData: {
        state: "acknowledged",
        assigneeUserId: updated.assigneeUserId,
      },
      actorType: "user",
      actorUserId: actor.userId,
      createdAt: now,
    });
    return { updated, existing: null };
  });

  if (!result) {
    return { ok: false, code: "not_found", error: "Incident not found or access denied" };
  }
  if (!result.updated) {
    const { existing } = result;
    if (existing.status === "resolved" && !existing.acknowledgedAt) {
      return { ok: false, code: "conflict", error: "Incident is already resolved" };
    }
    return { ok: true, incident: existing, changed: false, autoAssigned: false };
  }

  const { updated } = result;
  if (!updated) return { ok: false, code: "conflict", error: "Incident changed, reload and try again" };
  await audit(actor, "sre_incident_acknowledged", updated, {});
  notify(actor, incidentId, "acknowledged");
  return {
    ok: true,
    incident: updated,
    changed: true,
    autoAssigned: updated.assigneeUserId === actor.userId,
  };
}

export async function resolveIncident(
  actor: IncidentActor,
  incidentId: string,
  rawSummary: string,
): Promise<LifecycleResult<{ incident: IncidentRef; changed: boolean }>> {
  const summary = rawSummary.trim();
  if (!summary) {
    return { ok: false, code: "invalid", error: "A resolution summary is required" };
  }
  if (summary.length > MAX_RESOLUTION_SUMMARY_LENGTH) {
    return {
      ok: false,
      code: "invalid",
      error: `Resolution summary must be ${MAX_RESOLUTION_SUMMARY_LENGTH} characters or fewer`,
    };
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(sreIncidents)
      .set({
        status: "resolved",
        resolvedAt: now,
        mitigatedAt: sql`coalesce(${sreIncidents.mitigatedAt}, ${now.toISOString()}::timestamp)`,
        resolutionSummary: summary,
        updatedAt: now,
      })
      .where(and(scope(actor, incidentId), ne(sreIncidents.status, "resolved")))
      .returning({
        id: sreIncidents.id,
        incidentNumber: sreIncidents.incidentNumber,
        title: sreIncidents.title,
      });

    if (!updated) {
      const [existing] = await tx
        .select({
          id: sreIncidents.id,
          incidentNumber: sreIncidents.incidentNumber,
          title: sreIncidents.title,
          status: sreIncidents.status,
        })
        .from(sreIncidents)
        .where(scope(actor, incidentId))
        .limit(1);
      return existing?.status === "resolved"
        ? { incident: existing, changed: false }
        : null;
    }

    await tx.insert(sreIncidentTimelineEvents).values({
      incidentId,
      eventType: "state_change",
      eventData: { state: "resolved", comment: summary },
      actorType: "user",
      actorUserId: actor.userId,
      createdAt: now,
    });
    return { incident: updated, changed: true };
  });

  if (!result) {
    return { ok: false, code: "not_found", error: "Incident not found or access denied" };
  }
  if (result.changed) {
    await audit(actor, "sre_incident_resolved", result.incident, {});
    notify(actor, incidentId, "resolved");
  }
  return { ok: true, incident: result.incident, changed: result.changed };
}

export async function addIncidentUpdate(
  actor: IncidentActor,
  incidentId: string,
  rawText: string,
): Promise<LifecycleResult<{ incident: IncidentRef }>> {
  const text = rawText.trim();
  if (!text || text.length > MAX_INCIDENT_UPDATE_LENGTH) {
    return {
      ok: false,
      code: "invalid",
      error: `Update must be between 1 and ${MAX_INCIDENT_UPDATE_LENGTH} characters`,
    };
  }
  const [incident] = await db
    .select({
      id: sreIncidents.id,
      incidentNumber: sreIncidents.incidentNumber,
      title: sreIncidents.title,
    })
    .from(sreIncidents)
    .where(scope(actor, incidentId))
    .limit(1);
  if (!incident) {
    return { ok: false, code: "not_found", error: "Incident not found or access denied" };
  }
  await db.insert(sreIncidentTimelineEvents).values({
    incidentId,
    eventType: "comment",
    eventData: { text },
    actorType: "user",
    actorUserId: actor.userId,
    createdAt: new Date(),
  });
  await audit(actor, "sre_incident_update_added", incident, {});
  return { ok: true, incident };
}

// --- Alert-driven (system) transitions -------------------------------------
// Used by background alert processing under its advisory lock; callers announce
// the returned events with notifyIncidentEvent after the transaction commits.

/** A source's failure alert may reopen an auto-resolved incident for this long. */
export const INCIDENT_REOPEN_WINDOW_MS = 30 * 60 * 1000;

type SourceRef = {
  organizationId: string;
  projectId: string;
  sourceType: "monitor" | "job";
  sourceId: string;
};

// Only failures that a passing check really ends: monitor up/down and job failure/timeout.
// Never SSL-expiry (a passing check does not renew a certificate) or custom triggers.
const RECOVERABLE_ALERT_TYPES: AlertType[] = ["monitor_failure", "job_failed", "job_timeout"];
const RECOVERABLE_TITLES = ["Monitor Failure", "Job Failed", "Job Timeout"];

const recoverableTrigger = () =>
  or(
    ...RECOVERABLE_ALERT_TYPES.map((type) => sql`${sreAlertEvents.dedupKey} like ${`%:${type}`}`),
    ...RECOVERABLE_TITLES.map((title) => sql`${sreAlertEvents.title} like ${`%: ${title}`}`),
  );

const triggerSourceMatch = (source: SourceRef) =>
  and(
    recoverableTrigger(),
    eq(sreIncidents.organizationId, source.organizationId),
    eq(sreIncidents.projectId, source.projectId),
    eq(sreIncidentAlerts.role, "trigger"),
    eq(sreAlertEvents.sourceType, source.sourceType),
    eq(sreAlertEvents.sourceId, source.sourceId),
  );

function describeDuration(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest ? ` ${rest}m` : ""}`;
}

/**
 * Handle a recovery signal for a monitor/job: auto-resolve open, unacknowledged
 * trigger incidents (when allowed), otherwise leave a `recovered` note for the owner.
 */
export async function applySourceRecovery(
  tx: Executor,
  source: SourceRef & { targetName: string; autoResolve: boolean; recoveredAt: Date },
) {
  const open = await tx
    .select({
      id: sreIncidents.id,
      incidentNumber: sreIncidents.incidentNumber,
      title: sreIncidents.title,
      createdAt: sreIncidents.createdAt,
      acknowledgedAt: sreIncidents.acknowledgedAt,
      assigneeUserId: sreIncidents.assigneeUserId,
    })
    .from(sreIncidentAlerts)
    .innerJoin(sreIncidents, eq(sreIncidentAlerts.incidentId, sreIncidents.id))
    .innerJoin(sreAlertEvents, eq(sreIncidentAlerts.alertEventId, sreAlertEvents.id))
    .where(and(triggerSourceMatch(source), ne(sreIncidents.status, "resolved")));
  if (open.length === 0) return { resolved: [], recovered: [] };

  // A failure alert newer than this recovery means the recovery is stale; leave the incident alone.
  const [latestFailure] = await tx
    .select({ sentAt: sql<Date | null>`max(${alertHistory.sentAt})` })
    .from(alertHistory)
    .where(
      and(
        source.sourceType === "monitor"
          ? eq(alertHistory.monitorId, source.sourceId)
          : eq(alertHistory.jobId, source.sourceId),
        inArray(alertHistory.type, RECOVERABLE_ALERT_TYPES),
      ),
    );
  if (latestFailure?.sentAt && new Date(latestFailure.sentAt) > source.recoveredAt) {
    return { resolved: [], recovered: [] };
  }

  const resolved: { id: string }[] = [];
  const recovered: { id: string; assigneeUserId: string | null }[] = [];
  const seen = new Set<string>();
  for (const incident of open) {
    if (seen.has(incident.id)) continue;
    seen.add(incident.id);
    const now = source.recoveredAt;
    if (source.autoResolve && !incident.acknowledgedAt) {
      const summary = `Recovered automatically: ${source.targetName} passed again after ${describeDuration(now.getTime() - incident.createdAt.getTime())}.`;
      const [updated] = await tx
        .update(sreIncidents)
        .set({
          status: "resolved",
          resolvedAt: now,
          mitigatedAt: sql`coalesce(${sreIncidents.mitigatedAt}, ${now.toISOString()}::timestamp)`,
          resolutionSummary: summary,
          updatedAt: now,
        })
        .where(
          and(
            eq(sreIncidents.id, incident.id),
            ne(sreIncidents.status, "resolved"),
            isNull(sreIncidents.acknowledgedAt),
          ),
        )
        .returning({ id: sreIncidents.id });
      if (updated) {
        await tx.insert(sreIncidentTimelineEvents).values({
          incidentId: incident.id,
          eventType: "state_change",
          eventData: { state: "resolved", comment: summary, automatic: true },
          actorType: "system",
          createdAt: now,
        });
        resolved.push({ id: incident.id });
        continue;
      }
    }
    const [lastState] = await tx
      .select({ state: sql<string>`${sreIncidentTimelineEvents.eventData}->>'state'` })
      .from(sreIncidentTimelineEvents)
      .where(
        and(
          eq(sreIncidentTimelineEvents.incidentId, incident.id),
          eq(sreIncidentTimelineEvents.eventType, "state_change"),
        ),
      )
      .orderBy(desc(sreIncidentTimelineEvents.createdAt))
      .limit(1);
    if (lastState?.state === "recovered") continue; // already noted; do not repeat the note or email
    await tx.insert(sreIncidentTimelineEvents).values({
      incidentId: incident.id,
      eventType: "state_change",
      eventData: {
        state: "recovered",
        comment: `${source.targetName} recovered; resolve when you've confirmed`,
      },
      actorType: "system",
      createdAt: now,
    });
    recovered.push({ id: incident.id, assigneeUserId: incident.assigneeUserId });
  }
  return { resolved, recovered };
}

/**
 * Reopen the source's most recent trigger incident when it was auto-resolved
 * within the reopen window and no other incident for the source is open.
 */
export async function reopenRecentlyAutoResolved(
  tx: Executor,
  source: SourceRef & { firedAt: Date },
) {
  const [latest] = await tx
    .select({
      id: sreIncidents.id,
      status: sreIncidents.status,
      resolvedAt: sreIncidents.resolvedAt,
      assigneeUserId: sreIncidents.assigneeUserId,
      triageInvestigationRunId: sreIncidents.triageInvestigationRunId,
    })
    .from(sreIncidentAlerts)
    .innerJoin(sreIncidents, eq(sreIncidentAlerts.incidentId, sreIncidents.id))
    .innerJoin(sreAlertEvents, eq(sreIncidentAlerts.alertEventId, sreAlertEvents.id))
    .where(triggerSourceMatch(source))
    .orderBy(desc(sreIncidents.createdAt))
    .limit(1);
  if (
    !latest ||
    latest.status !== "resolved" ||
    !latest.resolvedAt ||
    source.firedAt.getTime() - latest.resolvedAt.getTime() >= INCIDENT_REOPEN_WINDOW_MS
  ) {
    return null;
  }

  // Only when the most recent resolve/reopen was the automatic one; a person's later resolve wins.
  const [lastResolution] = await tx
    .select({
      state: sql<string>`${sreIncidentTimelineEvents.eventData}->>'state'`,
      automatic: sql<string | null>`${sreIncidentTimelineEvents.eventData}->>'automatic'`,
    })
    .from(sreIncidentTimelineEvents)
    .where(
      and(
        eq(sreIncidentTimelineEvents.incidentId, latest.id),
        eq(sreIncidentTimelineEvents.eventType, "state_change"),
        sql`${sreIncidentTimelineEvents.eventData}->>'state' in ('resolved', 'reopened')`,
      ),
    )
    .orderBy(desc(sreIncidentTimelineEvents.createdAt))
    .limit(1);
  if (lastResolution?.state !== "resolved" || lastResolution.automatic !== "true") return null;

  const now = new Date();
  const [updated] = await tx
    .update(sreIncidents)
    .set({
      status: "triggered",
      resolvedAt: null,
      mitigatedAt: null,
      resolutionSummary: null,
      // A returning failure needs a fresh acknowledgement (and stays auto-resolvable).
      acknowledgedAt: null,
      acknowledgedByUserId: null,
      updatedAt: now,
    })
    .where(and(eq(sreIncidents.id, latest.id), eq(sreIncidents.status, "resolved")))
    .returning({ id: sreIncidents.id });
  if (!updated) return null;

  await tx.insert(sreIncidentTimelineEvents).values({
    incidentId: latest.id,
    eventType: "state_change",
    eventData: { state: "reopened", comment: "Failure returned within 30 minutes of automatic recovery" },
    actorType: "system",
    createdAt: now,
  });
  return {
    incidentId: latest.id,
    assigneeUserId: latest.assigneeUserId,
    alreadyTriaged: Boolean(latest.triageInvestigationRunId),
  };
}

/** Audit + announce an alert-driven transition (best effort; never throws). */
export async function announceSystemTransition(
  organizationId: string,
  projectId: string,
  incidentId: string,
  event: "resolved" | "recovered" | "reopened",
  extra: { assigneeUserId?: string | null; discriminator: string },
) {
  await logAuditEvent({
    organizationId,
    action: `sre_incident_${event === "resolved" ? "auto_resolved" : event}`,
    resource: "sre_incident",
    resourceId: incidentId,
    metadata: { projectId },
    success: true,
  }).catch(() => undefined);
  await notifyIncidentEvent({
    organizationId,
    projectId,
    incidentId,
    event,
    automatic: event === "resolved",
    assigneeUserId: extra.assigneeUserId,
    dedupeDiscriminator: extra.discriminator,
  }).catch(() => undefined);
}
