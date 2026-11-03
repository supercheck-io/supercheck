import { and, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import {
  jobs, member, monitorResults, monitors, oauthConsent, organization, projects, reports, runs, statusPages,
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

/** Who may still be a member when the organization is deleted: nobody, or only this user. */
export type MembershipGuard = { onlyMemberUserId: string } | { noMembers: true };

async function assertMembership(executor: Pick<typeof db, "select">, organizationId: string, guard: MembershipGuard) {
  const rows = await executor.select({ userId: member.userId }).from(member).where(eq(member.organizationId, organizationId));
  const ok = "noMembers" in guard
    ? rows.length === 0
    : rows.length === 1 && rows[0].userId === guard.onlyMemberUserId;
  if (!ok) throw new OrganizationMembershipChangedError("The organization's members changed; nothing was deleted");
}

/** Subscriptions that still bill and must be revoked before the organization disappears. */
export function hasCancellableSubscription(org: { subscriptionId: string | null; subscriptionStatus: string | null }) {
  return !!org.subscriptionId && org.subscriptionStatus !== "none";
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

async function revokeSubscription(subscriptionId: string): Promise<void> {
  const config = isPolarEnabled() ? getPolarConfig() : null;
  // A billing subscription must never outlive its organization silently.
  if (!config) throw new BillingCancellationError("Billing is not configured, so the subscription cannot be cancelled");
  try {
    await createPolarClient({ accessToken: config.accessToken, server: config.server }).subscriptions.revoke(subscriptionId);
  } catch (error) {
    if (isAlreadyGone(error)) return;
    console.error(`[ORG_TEARDOWN] Failed to revoke subscription ${subscriptionId}:`, error);
    throw new BillingCancellationError("Could not cancel the subscription with the billing provider");
  }
}

/** Best effort: removes stored files of the projects; failures are logged and counted, never block the delete. */
async function deleteProjectArtifacts(projectIds: string[], monitorIds: string[], statusPageIds: string[]) {
  const s3 = createS3CleanupService();
  let failures = 0;
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
      try { inputs.push(...s3.getRunArtifactInputs(r as Parameters<typeof s3.getRunArtifactInputs>[0])); }
      catch (error) { failures++; console.error(`[ORG_TEARDOWN] run ${r.id} artifacts:`, error); }
    }
    if (inputs.length) await run("run artifacts", () => s3.deleteReports(inputs));
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
  for (const id of statusPageIds) {
    await run("status page assets", () => s3.deletePrefix(s3.bucket("statusBucketName"), `status-pages/${id}/`));
  }
  return failures;
}

/**
 * Permanently deletes an organization and everything it owns. Checks the membership guard, cancels
 * a billing subscription (throws BillingCancellationError and changes nothing if that fails; a retry
 * after a later failure is safe because an already cancelled subscription counts as done), stops schedules, removes
 * stored files (best effort), then deletes projects and the organization in one transaction.
 * Audit logs are kept (no foreign key).
 */
export async function deleteOrganizationCompletely(
  organizationId: string,
  guard: MembershipGuard,
  actorUserId: string,
): Promise<{ s3Failures: number; subscriptionCancelled: boolean } | null> {
  const [org] = await db
    .select({ id: organization.id, subscriptionId: organization.subscriptionId, subscriptionStatus: organization.subscriptionStatus })
    .from(organization).where(eq(organization.id, organizationId)).limit(1);
  if (!org) return null;

  // Checked before anything irreversible, and again under the row lock before the final delete.
  await assertMembership(db, organizationId, guard);
  const subscriptionCancelled = hasCancellableSubscription(org);
  // Written before anything irreversible: it records intent, and lets the billing webhooks that
  // follow the cancellation recognise the subscription of a deleted organization (TEARDOWN_ACTION).
  await logAdminEvent(actorUserId, "organization_teardown_started", organizationId, "organization", organizationId, {
    organizationId, subscriptionId: subscriptionCancelled ? org.subscriptionId : undefined,
  });
  if (subscriptionCancelled) await revokeSubscription(org.subscriptionId!);

  // Soft-delete first: the job scheduler skips deleted projects while the teardown runs.
  const projectRows = await db
    .update(projects).set({ status: "deleted", updatedAt: new Date() })
    .where(eq(projects.organizationId, organizationId))
    .returning({ id: projects.id });
  const projectIds = projectRows.map((p) => p.id);

  let s3Failures = 0;
  if (projectIds.length) {
    const monitorRows = await db
      .update(monitors).set({ status: "paused", updatedAt: new Date() })
      .where(eq(monitors.organizationId, organizationId))
      .returning({ id: monitors.id, scheduledJobId: monitors.scheduledJobId });
    const { unscheduleMonitors } = await import("@/lib/execution/trial-lifecycle");
    await unscheduleMonitors(monitorRows, db);

    const { deleteScheduledJob } = await import("@/lib/job-scheduler");
    const scheduled = await db.select({ id: jobs.id }).from(jobs)
      .where(and(inArray(jobs.projectId, projectIds), isNotNull(jobs.cronSchedule)));
    for (const job of scheduled) {
      try { await deleteScheduledJob(job.id); }
      catch (error) { console.error(`[ORG_TEARDOWN] unschedule job ${job.id}:`, error); }
    }

    const pages = await db.select({ id: statusPages.id }).from(statusPages).where(eq(statusPages.organizationId, organizationId));
    s3Failures = await deleteProjectArtifacts(projectIds, monitorRows.map((m) => m.id), pages.map((p) => p.id));
  }

  await db.transaction(async (tx) => {
    await tx.select({ id: organization.id }).from(organization).where(eq(organization.id, organizationId)).for("update");
    await assertMembership(tx, organizationId, guard);
    // MCP consents reference projects by id without a foreign key.
    if (projectIds.length) await tx.delete(oauthConsent).where(inArray(oauthConsent.referenceId, projectIds));
    await tx.delete(projects).where(eq(projects.organizationId, organizationId));
    await tx.delete(organization).where(eq(organization.id, organizationId));
  });
  if (s3Failures) console.error(`[ORG_TEARDOWN] organization ${organizationId} deleted with ${s3Failures} S3 cleanup failures`);
  return { s3Failures, subscriptionCancelled };
}

/** Organizations whose only member is this user (deleted together with the user). */
export async function soleMemberOrganizations(userId: string) {
  const rows = await db
    .select({ id: organization.id, name: organization.name, subscriptionId: organization.subscriptionId, subscriptionStatus: organization.subscriptionStatus })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(
      eq(member.userId, userId),
      sql`not exists (select 1 from member other where other.organization_id = ${member.organizationId} and other.user_id <> ${userId})`,
    ));
  return rows.map(({ subscriptionId, subscriptionStatus, ...org }) => ({
    ...org,
    hasActiveSubscription: hasCancellableSubscription({ subscriptionId, subscriptionStatus }),
  }));
}
