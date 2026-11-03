import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import {
  jobs, member, monitorResults, monitors, oauthConsent, organization, projects, reports, runs, statusPages,
} from "@/db/schema";
import { getPolarConfig, isPolarEnabled } from "@/lib/feature-flags";
import { createPolarClient } from "@/lib/billing/polar-client";
import { createS3CleanupService, type ReportDeletionInput } from "@/lib/s3-cleanup";

const BATCH = 200;
const SRE_ATTACHMENTS_BUCKET = process.env.S3_SRE_ATTACHMENTS_BUCKET_NAME || "sre-chat-attachments";

export class BillingCancellationError extends Error {}

/** Subscriptions that still bill and must be revoked before the organization disappears. */
export function hasCancellableSubscription(org: { subscriptionId: string | null; subscriptionStatus: string | null }) {
  return !!org.subscriptionId && org.subscriptionStatus !== "none";
}

function isAlreadyGone(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return false;
  const status = (error as { statusCode: number }).statusCode;
  const detail = `${(error as { body?: unknown }).body ?? ""} ${(error as { message?: string }).message ?? ""}`;
  return status === 404 || (status === 403 && /AlreadyCanceled/i.test(detail));
}

async function revokeSubscription(subscriptionId: string): Promise<void> {
  const config = isPolarEnabled() ? getPolarConfig() : null;
  if (!config) return;
  try {
    await createPolarClient({ accessToken: config.accessToken, server: config.server }).subscriptions.revoke(subscriptionId);
  } catch (error) {
    if (isAlreadyGone(error)) return;
    throw new BillingCancellationError(
      `Could not cancel the subscription: ${error instanceof Error ? error.message : String(error)}`,
    );
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

  for (let offset = 0; ; offset += BATCH) {
    const batch = await db
      .select({ id: runs.id, reportS3Url: runs.reportS3Url, logsS3Url: runs.logsS3Url, metadata: runs.metadata })
      .from(runs).where(inArray(runs.projectId, projectIds)).orderBy(runs.id).limit(BATCH).offset(offset);
    if (!batch.length) break;
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
    for (let offset = 0; ; offset += BATCH) {
      const batch = await db
        .select({ id: monitorResults.id, testExecutionId: monitorResults.testExecutionId, testReportS3Url: monitorResults.testReportS3Url })
        .from(monitorResults)
        .where(and(
          inArray(monitorResults.monitorId, monitorIds),
          or(isNotNull(monitorResults.testExecutionId), isNotNull(monitorResults.testReportS3Url)),
        ))
        .orderBy(monitorResults.id).limit(BATCH).offset(offset);
      if (!batch.length) break;
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
 * Permanently deletes an organization and everything it owns: cancels a billing subscription
 * (throws BillingCancellationError and changes nothing if that fails), stops schedules, removes
 * stored files (best effort), then deletes projects and the organization in one transaction.
 * Audit logs are kept (no foreign key).
 */
export async function deleteOrganizationCompletely(organizationId: string): Promise<{ s3Failures: number } | null> {
  const [org] = await db
    .select({ id: organization.id, subscriptionId: organization.subscriptionId, subscriptionStatus: organization.subscriptionStatus })
    .from(organization).where(eq(organization.id, organizationId)).limit(1);
  if (!org) return null;

  if (hasCancellableSubscription(org)) await revokeSubscription(org.subscriptionId!);

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
    // MCP consents reference projects by id without a foreign key.
    if (projectIds.length) await tx.delete(oauthConsent).where(inArray(oauthConsent.referenceId, projectIds));
    await tx.delete(projects).where(eq(projects.organizationId, organizationId));
    await tx.delete(organization).where(eq(organization.id, organizationId));
  });
  if (s3Failures) console.error(`[ORG_TEARDOWN] organization ${organizationId} deleted with ${s3Failures} S3 cleanup failures`);
  return { s3Failures };
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
