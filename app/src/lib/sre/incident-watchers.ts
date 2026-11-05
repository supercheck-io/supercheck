import { and, eq, inArray, or, sql } from "drizzle-orm";

import { member, projectMembers, sreIncidentWatchers, user } from "@/db/schema";
import { db } from "@/utils/db";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const ORG_WIDE_ROLES = ["org_owner", "org_admin"];
// An org-level viewer sees every project (see getCurrentProjectContext); admins and editors need a project row.
const ORG_VIEW_ROLES = [...ORG_WIDE_ROLES, "project_viewer"];
const MAX_WATCHERS = 100;

/** Idempotent: a second call for the same pair changes nothing. */
export async function watchIncident(executor: Executor, incidentId: string, userId: string) {
  await executor.insert(sreIncidentWatchers).values({ incidentId, userId }).onConflictDoNothing();
}

export async function unwatchIncident(executor: Executor, incidentId: string, userId: string) {
  await executor
    .delete(sreIncidentWatchers)
    .where(and(eq(sreIncidentWatchers.incidentId, incidentId), eq(sreIncidentWatchers.userId, userId)));
}

export async function isWatchingIncident(incidentId: string, userId: string) {
  const [row] = await db
    .select({ id: sreIncidentWatchers.id })
    .from(sreIncidentWatchers)
    .where(and(eq(sreIncidentWatchers.incidentId, incidentId), eq(sreIncidentWatchers.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Watchers who can still see the project: org owners/admins, or members of this project at any
 * role. Unlike assignment, a read-only viewer may watch.
 */
export async function listWatchers(organizationId: string, projectId: string, incidentId: string) {
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(sreIncidentWatchers)
    .innerJoin(user, eq(user.id, sreIncidentWatchers.userId))
    .innerJoin(member, and(eq(member.userId, sreIncidentWatchers.userId), eq(member.organizationId, organizationId)))
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.userId, sreIncidentWatchers.userId), eq(projectMembers.projectId, projectId)),
    )
    .where(
      and(
        eq(sreIncidentWatchers.incidentId, incidentId),
        or(inArray(member.role, ORG_VIEW_ROLES), sql`${projectMembers.id} IS NOT NULL`),
      ),
    )
    .limit(MAX_WATCHERS);
}

/** Owners and admins of the project, for incidents nobody was assigned and no channel would reach. */
export async function listProjectAdmins(organizationId: string, projectId: string, limit = 20) {
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(projectMembers, and(eq(projectMembers.userId, member.userId), eq(projectMembers.projectId, projectId)))
    .where(
      and(
        eq(member.organizationId, organizationId),
        or(
          inArray(member.role, ORG_WIDE_ROLES),
          // Both roles must say admin, like assignment, so a stale project row cannot outlive an org downgrade.
          and(eq(projectMembers.role, "project_admin"), eq(member.role, "project_admin")),
        ),
      ),
    )
    .limit(limit);
}
