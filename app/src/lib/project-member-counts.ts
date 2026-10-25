import { and, count, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/utils/db";
import { member, projectMembers, projects } from "@/db/schema";

const ORG_WIDE_ROLES = ["org_owner", "org_admin"];

/**
 * Per-project member count: members assigned to the project who still belong
 * to its organization, plus the organization's owners/admins (implicit access,
 * counted once). Not an access count. Uses two grouped queries regardless of
 * how many projects are listed.
 */
export async function getProjectMemberCounts(
  projectList: Array<{ id: string; organizationId: string }>
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (projectList.length === 0) return counts;

  const projectIds = projectList.map((p) => p.id);
  const orgIds = [...new Set(projectList.map((p) => p.organizationId))];

  const [explicit, implicit] = await Promise.all([
    // Assigned members still in the org, excluding org-wide admins (counted below).
    db
      .select({ projectId: projectMembers.projectId, total: count() })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .innerJoin(
        member,
        and(
          eq(member.userId, projectMembers.userId),
          eq(member.organizationId, projects.organizationId)
        )
      )
      .where(
        and(
          inArray(projectMembers.projectId, projectIds),
          notInArray(member.role, ORG_WIDE_ROLES)
        )
      )
      .groupBy(projectMembers.projectId),
    db
      .select({ organizationId: member.organizationId, total: count() })
      .from(member)
      .where(
        and(
          inArray(member.organizationId, orgIds),
          inArray(member.role, ORG_WIDE_ROLES)
        )
      )
      .groupBy(member.organizationId),
  ]);

  const explicitByProject = new Map(explicit.map((r) => [r.projectId, Number(r.total)]));
  const implicitByOrg = new Map(implicit.map((r) => [r.organizationId, Number(r.total)]));

  for (const p of projectList) {
    counts.set(
      p.id,
      (explicitByProject.get(p.id) ?? 0) + (implicitByOrg.get(p.organizationId) ?? 0)
    );
  }
  return counts;
}

export async function withMemberCounts<T extends { id: string; organizationId: string }>(
  projectList: T[]
): Promise<Array<T & { membersCount: number }>> {
  const counts = await getProjectMemberCounts(projectList);
  return projectList.map((p) => ({ ...p, membersCount: counts.get(p.id) ?? 0 }));
}
