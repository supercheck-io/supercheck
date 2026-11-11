import { and, asc, eq, gt, inArray, isNotNull, isNull, ne, or, sql, type AnyColumn } from "drizzle-orm";
import { monitors, organization, planLimits, statusPages } from "@/db/schema";
import { createAuditLog } from "@/lib/audit-log";
import { unscheduleMonitors } from "@/lib/execution/trial-lifecycle";
import { hasPaidAccess } from "@/lib/execution/trial-limits";
import { notInDeletedProject } from "@/lib/middleware/plan-limit-lock";
import { db } from "@/utils/db";

/** Organizations repaired per run; the rest are picked up on the next run. */
const BATCH_SIZE = 50;

export const PLAN_CAP_AUDIT_ACTION = "plan_caps_enforced";

type Database = Pick<typeof db, "select" | "transaction" | "update">;

const activeMonitor = (organizationId: string | AnyColumn) => and(
  eq(monitors.organizationId, organizationId),
  ne(monitors.status, "paused"),
  isNull(monitors.deletingAt),
  notInDeletedProject(monitors.projectId),
);
const publishedPage = (organizationId: string | AnyColumn) => and(
  eq(statusPages.organizationId, organizationId),
  eq(statusPages.status, "published"),
  notInDeletedProject(statusPages.projectId),
);

/**
 * A plan change (for example Pro to Plus in the billing portal) can leave an organization running
 * more monitors or publishing more status pages than its new plan allows. Pauses the newest active
 * monitors and archives the newest published status pages above the cap. Nothing is deleted, and
 * these are not trial suspensions, so subscribing again never resumes them automatically.
 * Idempotent: organizations within their limits are untouched.
 */
export async function enforcePlanResourceCaps(
  options: { now?: Date; database?: Database } = {},
): Promise<{ organizations: number; monitorsPaused: number; statusPagesArchived: number }> {
  const now = options.now ?? new Date();
  const database = options.database ?? db;
  const result = { organizations: 0, monitorsPaused: 0, statusPagesArchived: 0 };

  const activeMonitors = sql<number>`(SELECT count(*) FROM ${monitors} WHERE ${activeMonitor(organization.id)})`;
  const published = sql<number>`(SELECT count(*) FROM ${statusPages} WHERE ${publishedPage(organization.id)})`;
  const candidates = await database
    .select({
      id: organization.id,
      subscriptionPlan: organization.subscriptionPlan,
      subscriptionStatus: organization.subscriptionStatus,
      subscriptionEndsAt: organization.subscriptionEndsAt,
      polarCustomerId: organization.polarCustomerId,
      maxMonitors: planLimits.maxMonitors,
      maxStatusPages: planLimits.maxStatusPages,
    })
    .from(organization)
    .innerJoin(planLimits, eq(planLimits.plan, organization.subscriptionPlan))
    .where(and(
      inArray(organization.subscriptionPlan, ["plus", "pro"]),
      isNotNull(organization.polarCustomerId),
      // Paid access in SQL, so lapsed organizations cannot fill the batch ahead of paying ones.
      or(
        inArray(organization.subscriptionStatus, ["active", "past_due"]),
        and(eq(organization.subscriptionStatus, "canceled"), gt(organization.subscriptionEndsAt, now)),
      ),
      or(gt(activeMonitors, planLimits.maxMonitors), gt(published, planLimits.maxStatusPages)),
    ))
    .orderBy(asc(organization.id))
    .limit(BATCH_SIZE);

  const toUnschedule: Array<{ id: string; scheduledJobId: string | null }> = [];
  for (const org of candidates) {
    // Lapsed organizations are handled by access checks; only cap a plan that is in force.
    if (!hasPaidAccess(org, now)) continue;
    try {
      const changed = await database.transaction(async (tx) => {
        // Serialize with webhooks and owner edits, then re-read. Oldest first: the earliest resources
        // within the cap keep running and everything after them is paused.
        const [locked] = await tx.select({ plan: organization.subscriptionPlan }).from(organization)
          .where(eq(organization.id, org.id)).for("update");
        if (!locked || locked.plan !== org.subscriptionPlan) return null;
        const excessMonitors = await tx.select({ id: monitors.id, scheduledJobId: monitors.scheduledJobId })
          .from(monitors).where(activeMonitor(org.id))
          .orderBy(asc(monitors.createdAt), asc(monitors.id)).offset(Math.max(0, org.maxMonitors));
        const excessPages = await tx.select({ id: statusPages.id })
          .from(statusPages).where(publishedPage(org.id))
          .orderBy(asc(statusPages.createdAt), asc(statusPages.id)).offset(Math.max(0, org.maxStatusPages));
        if (excessMonitors.length) {
          await tx.update(monitors).set({ status: "paused", updatedAt: now })
            .where(inArray(monitors.id, excessMonitors.map((row) => row.id)));
        }
        if (excessPages.length) {
          await tx.update(statusPages).set({ status: "archived", updatedAt: now })
            .where(inArray(statusPages.id, excessPages.map((row) => row.id)));
        }
        return { excessMonitors, excessPages };
      });
      if (!changed || (!changed.excessMonitors.length && !changed.excessPages.length)) continue;
      toUnschedule.push(...changed.excessMonitors);
      result.organizations += 1;
      result.monitorsPaused += changed.excessMonitors.length;
      result.statusPagesArchived += changed.excessPages.length;
      await createAuditLog({
        organizationId: org.id,
        action: PLAN_CAP_AUDIT_ACTION,
        details: {
          resource: "organization",
          resourceId: org.id,
          metadata: {
            plan: org.subscriptionPlan,
            pausedMonitorIds: changed.excessMonitors.map((row) => row.id),
            archivedStatusPageIds: changed.excessPages.map((row) => row.id),
          },
        },
      });
    } catch (error) {
      console.error(`Failed to apply plan limits for org ${org.id}:`, error);
    }
  }
  // After the commits, so a rolled-back pause never loses a schedule.
  await unscheduleMonitors(toUnschedule, database);
  return result;
}
