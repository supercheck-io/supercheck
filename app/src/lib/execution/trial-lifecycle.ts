import { and, eq, inArray, isNull, lte, ne } from "drizzle-orm";
import {
  executionEntitlements,
  monitors,
  organization,
  statusPages,
  trialSuspensions,
} from "@/db/schema";
import { db } from "@/utils/db";

/** How many expired trials one run processes; the rest are picked up on the next run. */
const BATCH_SIZE = 50;

export interface TrialEndResult {
  organizations: number;
  monitorsPaused: number;
  statusPagesArchived: number;
}

type Database = Pick<typeof db, "select" | "transaction">;

function hasPaidAccess(
  org: typeof organization.$inferSelect,
  now: Date,
): boolean {
  if (
    !org.polarCustomerId ||
    !["plus", "pro"].includes(org.subscriptionPlan ?? "")
  )
    return false;
  if (
    org.subscriptionStatus === "active" ||
    org.subscriptionStatus === "past_due"
  )
    return true;
  return (
    org.subscriptionStatus === "canceled" &&
    !!org.subscriptionEndsAt &&
    org.subscriptionEndsAt > now
  );
}

/**
 * Ends every expired trial exactly once. Monitors are paused and published
 * status pages are archived so an expired trial stops consuming resources.
 * Nothing is deleted: each change is recorded in trial_suspensions so
 * subscribing restores the organization's setup. Safe to run repeatedly.
 */
export async function endExpiredTrials(
  options: { now?: Date; database?: Database } = {},
): Promise<TrialEndResult> {
  const now = options.now ?? new Date();
  const database = options.database ?? db;
  const result: TrialEndResult = {
    organizations: 0,
    monitorsPaused: 0,
    statusPagesArchived: 0,
  };

  const expired = await database
    .select({ organizationId: executionEntitlements.organizationId })
    .from(executionEntitlements)
    .where(
      and(
        lte(executionEntitlements.expiresAt, now),
        isNull(executionEntitlements.lifecycleEndedAt),
      ),
    )
    .limit(BATCH_SIZE);

  for (const { organizationId } of expired) {
    await database.transaction(async (tx) => {
      // Serialize with a concurrent subscription or restore for this organization.
      const [org] = await tx
        .select()
        .from(organization)
        .where(eq(organization.id, organizationId))
        .for("update");
      const markEnded = () =>
        tx
          .update(executionEntitlements)
          .set({ lifecycleEndedAt: now })
          .where(
            and(
              eq(executionEntitlements.organizationId, organizationId),
              isNull(executionEntitlements.lifecycleEndedAt),
            ),
          );

      // A paying organization keeps everything; only record that the trial is over.
      if (!org || hasPaidAccess(org, now)) {
        await markEnded();
        return;
      }

      const running = await tx
        .select({ id: monitors.id, status: monitors.status })
        .from(monitors)
        .where(
          and(
            eq(monitors.organizationId, organizationId),
            ne(monitors.status, "paused"),
          ),
        );
      const published = await tx
        .select({ id: statusPages.id })
        .from(statusPages)
        .where(
          and(
            eq(statusPages.organizationId, organizationId),
            eq(statusPages.status, "published"),
          ),
        );

      const suspensions = [
        ...running.map((monitor) => ({
          organizationId,
          resourceType: "monitor" as const,
          resourceId: monitor.id,
          previousStatus: monitor.status as string,
        })),
        ...published.map((page) => ({
          organizationId,
          resourceType: "status_page" as const,
          resourceId: page.id,
          previousStatus: "published",
        })),
      ];
      if (suspensions.length)
        await tx
          .insert(trialSuspensions)
          .values(suspensions)
          .onConflictDoNothing();

      if (running.length) {
        await tx
          .update(monitors)
          .set({ status: "paused", updatedAt: now })
          .where(
            inArray(
              monitors.id,
              running.map((m) => m.id),
            ),
          );
      }
      if (published.length) {
        await tx
          .update(statusPages)
          .set({ status: "archived", updatedAt: now })
          .where(
            inArray(
              statusPages.id,
              published.map((p) => p.id),
            ),
          );
      }
      await markEnded();

      result.organizations += 1;
      result.monitorsPaused += running.length;
      result.statusPagesArchived += published.length;
    });
  }

  return result;
}

/**
 * Brings back what the trial end paused or archived once the organization
 * subscribes. A resource the user changed since is left as they set it.
 */
export async function restoreTrialSuspensions(
  organizationId: string,
  database: Pick<typeof db, "transaction"> = db,
): Promise<{ monitorsResumed: number; statusPagesRestored: number }> {
  return database.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(trialSuspensions)
      .where(eq(trialSuspensions.organizationId, organizationId));
    const monitorIds = rows
      .filter((row) => row.resourceType === "monitor")
      .map((row) => row.resourceId);
    const pageIds = rows
      .filter((row) => row.resourceType === "status_page")
      .map((row) => row.resourceId);
    const now = new Date();

    // A resumed monitor starts as pending so its first check sets the real state.
    const resumed = monitorIds.length
      ? await tx
          .update(monitors)
          .set({ status: "pending", updatedAt: now })
          .where(
            and(
              inArray(monitors.id, monitorIds),
              eq(monitors.status, "paused"),
            ),
          )
          .returning({ id: monitors.id })
      : [];
    const restored = pageIds.length
      ? await tx
          .update(statusPages)
          .set({ status: "published", updatedAt: now })
          .where(
            and(
              inArray(statusPages.id, pageIds),
              eq(statusPages.status, "archived"),
            ),
          )
          .returning({ id: statusPages.id })
      : [];
    if (rows.length)
      await tx
        .delete(trialSuspensions)
        .where(eq(trialSuspensions.organizationId, organizationId));

    return {
      monitorsResumed: resumed.length,
      statusPagesRestored: restored.length,
    };
  });
}
