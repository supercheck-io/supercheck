import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import {
  executionUsageReceipts, jobs, member, monitorResults, monitors, oauthConsent, organization, projects, reports, runs, statusPages, usageEvents,
} from "@/db/schema";
import { getPolarConfig, isPolarEnabled } from "@/lib/feature-flags";
import { createPolarClient } from "@/lib/billing/polar-client";
import { createS3CleanupService, type ReportDeletionInput } from "@/lib/s3-cleanup";
import { logAdminEvent } from "@/lib/audit-logger";
export { TEARDOWN_ACTION } from "@/lib/organization-teardown-action";

const BATCH = 200;
const SRE_ATTACHMENTS_BUCKET = process.env.S3_SRE_ATTACHMENTS_BUCKET_NAME || "sre-chat-attachments";

export class BillingCancellationError extends Error {}
/** The organization's members changed since the admin confirmed the deletion. */
export class OrganizationMembershipChangedError extends Error {}

/** Who may still be a member when the organization is deleted: nobody, only this user, or any members while this user is still an owner. */
export type MembershipGuard = { onlyMemberUserId: string } | { noMembers: true } | { ownerUserId: string };

async function assertMembership(executor: Pick<typeof db, "select">, organizationId: string, guard: MembershipGuard) {
  // FOR SHARE: a concurrent demotion or removal of these members waits for the teardown to finish.
  const rows = await executor.select({ userId: member.userId, role: member.role }).from(member).where(eq(member.organizationId, organizationId)).for("share");
  const ok = "noMembers" in guard
    ? rows.length === 0
    : "ownerUserId" in guard
      ? rows.some((row) => row.userId === guard.ownerUserId && row.role === "org_owner")
      : rows.length === 1 && rows[0].userId === guard.onlyMemberUserId;
  if (!ok) throw new OrganizationMembershipChangedError("The organization's members changed; nothing was deleted");
}

/** Any bound subscription is ended: provider states such as trialing or paused are stored locally as "none". */
export function hasCancellableSubscription(org: { subscriptionId: string | null }) {
  return !!org.subscriptionId;
}

function isAlreadyGone(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return false;
  const { statusCode, name } = error as { statusCode: number; name?: string };
  if (statusCode === 404) {
    console.warn("[ORG_TEARDOWN] Subscription not found at the billing provider; treating it as already gone");
    return true;
  }
  // SDK errors carry the provider error code in name/error; the message also embeds the JSON body.
  const detail = `${name ?? ""} ${JSON.stringify(error)} ${(error as { message?: string }).message ?? ""}`;
  return statusCode === 403 && /AlreadyCanceledSubscription/.test(detail);
}

/** Polar invoices usage ingested before an immediate cancellation, so unsent usage would never be billed. */
async function flushFinalUsage(organizationId: string): Promise<void> {
  const { polarUsageService } = await import("@/lib/services/polar-usage.service");
  const { pending } = await polarUsageService.flushOrganizationUsage(organizationId);
  if (pending > 0) {
    throw new BillingCancellationError("Could not send the organization's final usage to the billing provider. Nothing was deleted and the subscription is unchanged. Retry the deletion once billing is available.");
  }
}

/**
 * Usage that was never settled would be lost with the organization (both tables cascade): a completed
 * execution whose receipt is unsettled, and a usage event parked for manual reconciliation because its
 * billing period had closed. Refusing keeps that evidence; deletion can be retried once it is settled.
 */
async function assertNoUnsettledUsage(executor: Pick<typeof db, "select">, organizationId: string): Promise<void> {
  const [receipts] = await executor.select({ count: sql<number>`count(*)::int` }).from(executionUsageReceipts)
    .where(and(eq(executionUsageReceipts.organizationId, organizationId), isNull(executionUsageReceipts.settledAt)));
  const { CLOSED_USAGE_PERIOD_ERROR } = await import("@/lib/services/polar-usage.service");
  const [parked] = await executor.select({ count: sql<number>`count(*)::int` }).from(usageEvents)
    .where(and(eq(usageEvents.organizationId, organizationId), eq(usageEvents.syncedToPolar, false),
      // The flush skips closed periods, whether or not the sync loop has marked them yet.
      or(eq(usageEvents.syncError, CLOSED_USAGE_PERIOD_ERROR), lte(usageEvents.billingPeriodEnd, new Date()))));
  if ((receipts?.count ?? 0) > 0 || (parked?.count ?? 0) > 0) {
    throw new BillingCancellationError("The organization still has usage that was not billed (an unsettled execution or a closed billing period awaiting manual reconciliation). Nothing was deleted. Settle it, then retry the deletion.");
  }
}

/**
 * The subscription id to end. Normally the stored one; when checkout finished but its webhook has not
 * stored the id yet, ask the provider for the customer's active subscriptions. Only ones tagged to this
 * organization are ended; an untagged one (legacy) cannot be attributed, so deletion is refused (fail closed).
 */
async function resolveSubscriptionId(org: { id: string; subscriptionId: string | null; polarCustomerId: string | null }): Promise<string | null> {
  if (org.subscriptionId) return org.subscriptionId;
  const config = org.polarCustomerId && isPolarEnabled() ? getPolarConfig() : null;
  if (!org.polarCustomerId || !config) return null;
  try {
    const state = await createPolarClient({ accessToken: config.accessToken, server: config.server }).customers.getState(org.polarCustomerId);
    const owned = state.active_subscriptions.filter((subscription) => {
      const referenceId = (subscription.metadata as Record<string, unknown> | undefined)?.referenceId;
      if (typeof referenceId !== "string") throw new BillingCancellationError("The billing customer has a subscription that cannot be matched to this organization. Nothing was deleted. Contact support.");
      return referenceId === org.id;
    });
    if (owned.length > 1) throw new BillingCancellationError("The organization has several active subscriptions. Nothing was deleted. Contact support.");
    return owned[0]?.id ?? null;
  } catch (error) {
    if (error instanceof BillingCancellationError) throw error;
    console.error("[ORG_TEARDOWN] Failed to look up the customer's subscriptions:", error);
    throw new BillingCancellationError("Could not check the organization's subscription with the billing provider. Nothing was deleted. Retry the deletion once billing is available.");
  }
}

async function revokeSubscription(subscriptionId: string): Promise<void> {
  const config = isPolarEnabled() ? getPolarConfig() : null;
  // A billing subscription must never outlive its organization silently.
  if (!config) throw new BillingCancellationError("Billing is not configured, so the subscription cannot be cancelled");
  try {
    await createPolarClient({ accessToken: config.accessToken, server: config.server }).subscriptions.revoke(subscriptionId);
  } catch (error) {
    if (isAlreadyGone(error)) return;
    console.error(`[ORG_TEARDOWN] Failed to revoke subscription ${subscriptionId}:`, error);
    throw new BillingCancellationError("Could not cancel the subscription with the billing provider. Stored files may already be removed; organization records are unchanged. Retry the deletion once billing is available.");
  }
}

/** Removes stored files of the projects; returns how many objects or prefixes failed. */
async function deleteProjectArtifacts(projectIds: string[], monitorIds: string[], statusPageIds: string[]) {
  const s3 = createS3CleanupService();
  try {
    return await sweepProjectArtifacts(s3, projectIds, monitorIds, statusPageIds);
  } finally {
    s3.destroy();
  }
}

async function sweepProjectArtifacts(
  s3: ReturnType<typeof createS3CleanupService>,
  projectIds: string[],
  monitorIds: string[],
  statusPageIds: string[],
) {
  let failures = 0;
  const testIds = new Set<string>();
  const unparsedRunIds: string[] = [];
  const run = async (label: string, fn: () => Promise<{ success: boolean; failedObjects: unknown[] }>) => {
    try {
      const result = await fn();
      if (!result.success) failures += result.failedObjects.length || 1;
    } catch (error) {
      failures++;
      console.error(`[ORG_TEARDOWN] ${label} cleanup failed:`, error);
    }
  };

  for (let after = ""; ;) {
    const batch = await db
      .select({ id: runs.id, reportS3Url: runs.reportS3Url, logsS3Url: runs.logsS3Url, metadata: runs.metadata })
      .from(runs).where(and(inArray(runs.projectId, projectIds), after ? gt(runs.id, after) : undefined))
      .orderBy(runs.id).limit(BATCH);
    if (!batch.length) break;
    after = batch[batch.length - 1].id;
    const runIds = batch.map((r) => r.id);
    const rows = await db.select().from(reports).where(or(
      inArray(reports.entityId, runIds),
      and(eq(reports.entityType, "test"), inArray(reports.reportPath, runIds.map((id) => `${id}/report`))),
    ));
    const inputs: ReportDeletionInput[] = rows.map((r) => ({
      reportPath: r.reportPath, s3Url: r.s3Url || undefined, entityId: r.entityId,
      entityType: r.entityType as ReportDeletionInput["entityType"],
    }));
    for (const r of batch) {
      const testId = (r.metadata as { testId?: unknown } | null)?.testId;
      if (typeof testId === "string" && /^[0-9a-f-]{36}$/i.test(testId)) testIds.add(testId);
      try { inputs.push(...s3.getRunArtifactInputs(r as Parameters<typeof s3.getRunArtifactInputs>[0])); }
      catch (error) {
        // Unrecognised URL: run artifacts are keyed by run id, so sweep that folder in every run bucket.
        console.error(`[ORG_TEARDOWN] run ${r.id} artifacts (sweeping by run id):`, error);
        unparsedRunIds.push(r.id);
      }
    }
    if (inputs.length) await run("run artifacts", () => s3.deleteReports(inputs));
    for (const id of unparsedRunIds.splice(0)) {
      for (const bucket of ["jobBucketName", "testBucketName", "k6JobBucketName", "k6TestBucketName"] as const) {
        await run("run folder", () => s3.deletePrefix(s3.bucket(bucket), `${id}/`));
      }
    }
    if (batch.length < BATCH) break;
  }

  if (monitorIds.length) {
    for (let after = ""; ;) {
      const batch = await db
        .select({ id: monitorResults.id, testExecutionId: monitorResults.testExecutionId, testReportS3Url: monitorResults.testReportS3Url })
        .from(monitorResults)
        .where(and(
          inArray(monitorResults.monitorId, monitorIds),
          or(isNotNull(monitorResults.testExecutionId), isNotNull(monitorResults.testReportS3Url)),
          after ? gt(monitorResults.id, after) : undefined,
        ))
        .orderBy(monitorResults.id).limit(BATCH);
      if (!batch.length) break;
      after = batch[batch.length - 1].id;
      const inputs: ReportDeletionInput[] = batch.map((r) => ({
        entityType: "monitor", entityId: r.id,
        reportPath: r.testExecutionId || undefined, s3Url: r.testReportS3Url || undefined,
      }));
      await run("monitor artifacts", () => s3.deleteReports(inputs));
      if (batch.length < BATCH) break;
    }
  }

  // Files that only exist in S3 (no report row), keyed by project or status page.
  for (const id of projectIds) {
    await run("requirement documents", () => s3.deletePrefix(s3.bucket("requirementsBucketName"), `projects/${id}/`));
    await run("project data files", () => s3.deletePrefix(s3.bucket("projectDataFilesBucketName"), `projects/${id}/`));
    await run("SRE attachments", () => s3.deletePrefix(SRE_ATTACHMENTS_BUCKET, `projects/${id}/`));
  }
  // Saved browser runs write their report under the test id in the test bucket.
  for (const id of testIds) {
    await run("test reports", () => s3.deletePrefix(s3.bucket("testBucketName"), `${id}/`));
  }
  for (const id of statusPageIds) {
    await run("status page assets", () => s3.deletePrefix(s3.bucket("statusBucketName"), `status-pages/${id}/`));
  }
  return failures;
}

/** Stored files could not all be removed. The database is unchanged (some files may be gone); a retry finishes. */
export class StorageCleanupError extends Error {}

/**
 * Permanently deletes an organization and everything it owns, in one transaction that holds the
 * organization row lock (FOR UPDATE). The lock conflicts with the foreign-key locks of new members,
 * projects, monitors, tests and jobs, so the organization is frozen until the delete commits.
 *
 * Order: membership guard and audit marker; send unsynced usage (BillingCancellationError, nothing
 * changed); stop schedules; remove stored files (StorageCleanupError
 * if any object fails, nothing deleted from the database and billing untouched); end the subscription
 * last (BillingCancellationError, nothing deleted); delete projects and the organization. Audit logs
 * are kept. Rollback leaves schedules removed and some files gone; a retry finishes the job (the sweep
 * is idempotent, an ended subscription counts as done) and active monitors are rescheduled on the next app start.
 */
export async function deleteOrganizationCompletely(
  organizationId: string,
  guard: MembershipGuard,
  actorUserId: string,
): Promise<{ subscriptionCancelled: boolean } | null> {
  return db.transaction(async (tx) => {
    // Fail fast instead of queueing other writers behind a busy organization row.
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
    const [org] = await tx
      .select({ id: organization.id, subscriptionId: organization.subscriptionId, polarCustomerId: organization.polarCustomerId })
      .from(organization).where(eq(organization.id, organizationId)).for("update");
    if (!org) return null;
    // Lock the projects too (same order as other org-then-project writers) before anything
    // irreversible: a writer holding a project FOR SHARE would otherwise deadlock the final delete.
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, organizationId)).for("no key update");
    await assertMembership(tx, organizationId, guard);

    const subscriptionId = await resolveSubscriptionId(org);
    // Lets the provider events that follow the cancellation recognise a deleted organization.
    await logAdminEvent(actorUserId, "organization_teardown_started", organizationId, "organization", organizationId, {
      organizationId, subscriptionId: subscriptionId ?? undefined,
    }, tx);
    const subscriptionCancelled = hasCancellableSubscription({ subscriptionId });
    // Before anything irreversible (the file sweep): a provider outage here leaves everything intact.
    if (subscriptionCancelled && org.polarCustomerId) {
      await flushFinalUsage(organizationId);
      await assertNoUnsettledUsage(tx, organizationId);
    }

    const projectIds = (await tx.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, organizationId))).map((p) => p.id);
    if (projectIds.length) {
      const monitorRows = await tx.select({ id: monitors.id, scheduledJobId: monitors.scheduledJobId })
        .from(monitors).where(eq(monitors.organizationId, organizationId));
      const scheduledJobs = await tx.select({ id: jobs.id }).from(jobs)
        .where(and(inArray(jobs.projectId, projectIds), isNotNull(jobs.cronSchedule)));
      // Stop new executions before collecting files, so no new artifacts appear after the sweep.
      const { deleteScheduledMonitor } = await import("@/lib/monitor-scheduler");
      const { deleteScheduledJob } = await import("@/lib/job-scheduler");
      for (const row of monitorRows) {
        for (const id of new Set([row.id, row.scheduledJobId].filter((v): v is string => !!v))) {
          try { await deleteScheduledMonitor(id); } catch (error) { console.error(`[ORG_TEARDOWN] unschedule monitor ${id}:`, error); }
        }
      }
      for (const job of scheduledJobs) {
        try { await deleteScheduledJob(job.id); } catch (error) { console.error(`[ORG_TEARDOWN] unschedule job ${job.id}:`, error); }
      }

      const pages = await tx.select({ id: statusPages.id }).from(statusPages).where(eq(statusPages.organizationId, organizationId));
      const failures = await deleteProjectArtifacts(projectIds, monitorRows.map((m) => m.id), pages.map((p) => p.id));
      if (failures) {
        throw new StorageCleanupError(
          `${failures} stored file(s) could not be removed. The organization and its data are still in the database (some files may already be gone); retry the deletion to finish`,
        );
      }
    }
    // Last step before the irreversible deletes: any earlier failure leaves billing untouched.
    if (subscriptionId) await revokeSubscription(subscriptionId);
    if (projectIds.length) {
      // MCP consents reference projects by id without a foreign key.
      await tx.delete(oauthConsent).where(inArray(oauthConsent.referenceId, projectIds));
      await tx.delete(projects).where(eq(projects.organizationId, organizationId));
    }
    await tx.delete(organization).where(eq(organization.id, organizationId));
    return { subscriptionCancelled };
  });
}

/** Organizations whose only member is this user (deleted together with the user). */
export async function soleMemberOrganizations(userId: string) {
  const rows = await db
    .select({ id: organization.id, name: organization.name, subscriptionId: organization.subscriptionId })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(
      eq(member.userId, userId),
      sql`not exists (select 1 from member other where other.organization_id = ${member.organizationId} and other.user_id <> ${userId})`,
    ));
  return rows.map(({ subscriptionId, ...org }) => ({
    ...org,
    hasActiveSubscription: hasCancellableSubscription({ subscriptionId }),
  }));
}
