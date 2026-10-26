import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import {
  member,
  projectMembers,
  sreIncidentTimelineEvents,
  sreIncidents,
  sreServiceOwners,
  sreServices,
  user,
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
      email: user.email,
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
  extra: { assigneeUserId?: string | null; detail?: string } = {},
) {
  // Never let a delivery problem fail the user action; the notifier logs its own errors.
  void notifyIncidentEvent({
    organizationId: actor.organizationId,
    projectId: actor.projectId,
    incidentId,
    event,
    actorUserId: actor.userId,
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
        mitigatedAt: sql`coalesce(${sreIncidents.mitigatedAt}, ${now})`,
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
