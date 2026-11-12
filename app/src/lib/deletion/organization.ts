import { and, asc, eq, gt, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { deletionJobs, jobs, member, monitors, organization, projects, runs } from "@/db/schema";
import { logAdminEvent, logAuditEvent } from "@/lib/audit-logger";
import { RUN_CANCELLATION_MARKER, setCancellationSignal } from "@/lib/cancellation-service";
import { deleteScheduledJob, scheduleJob } from "@/lib/job-scheduler";
import { removeScheduledMonitor } from "@/lib/monitor-scheduler";
import { reconcileMonitorSchedule } from "@/lib/monitor-schedule-reconcile";
import { getNextRunDate } from "@/lib/scheduler/cron-utils";
import { isEmailConfigured } from "@/lib/email-service";
import { isSelfHosted } from "@/lib/feature-flags";
import {
  BillingCancellationError, cancelSubscriptionAtPeriodEnd, flushFinalUsage, hasCancellableSubscription, reinstateSubscription,
} from "./billing";
import { closeDeletionJobs, expediteDeletionJob, insertDeletionJob } from "./jobs";
import { sendOrganizationNotice } from "./notices";
import { triggerDeletion } from "./queue";
import { invalidateOrgState, metaPatch, organizationGraceDays, type DeletionMeta } from "./org-state";

export class OrganizationDeletionError extends Error {
  constructor(message: string, readonly status: 403 | 404 | 409 | 502, readonly code?: string) { super(message); }
}

/** Who may be a member when the request is made: this owner (customer flow), nobody (orphan cleanup), only this user (account deletion), or anyone (admin flow). */
export type MembershipGuard = { ownerUserId: string } | { noMembers: true } | { onlyMemberUserId: string } | { any: true };
/** The organization's members changed since the caller confirmed the deletion. */
export class OrganizationMembershipChangedError extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function assertMembership(tx: Tx, organizationId: string, guard: MembershipGuard) {
  if ("any" in guard) return;
  // FOR SHARE: a concurrent demotion or removal of these members waits for this transaction.
  const rows = await tx.select({ userId: member.userId, role: member.role }).from(member).where(eq(member.organizationId, organizationId)).for("share");
  const ok = "noMembers" in guard
    ? rows.length === 0
    : "ownerUserId" in guard
      ? rows.some((row) => row.userId === guard.ownerUserId && row.role === "org_owner")
      : rows.length === 1 && rows[0].userId === guard.onlyMemberUserId;
  if (!ok) throw new OrganizationMembershipChangedError("The organization's members changed; nothing was changed");
}

/**
 * Billing transitions of one organization (cancel at period end, reinstate) run one at a time, across pods: the advisory lock
 * is held on a transaction for the whole provider call, so a late reinstate of an old cancellation cannot interleave with a
 * new request's cancel, and each transition re-reads the organization state after it holds the lock.
 */
async function withBillingLock<T>(organizationId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '60s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`org-billing:${organizationId}`}))`);
    return work(tx);
  });
}

const lockTimeout = (tx: Tx) => tx.execute(sql`SET LOCAL lock_timeout = '10s'`);

export type DeletionRequestResult =
  | { status: "requested" | "already"; purgeAfter: Date; deletionId: string | null; billing: "cancelled" | "already" | "none" | "skipped" | "retry" }
  | null;

/**
 * Phase one of an organization delete, always a pending window. One transaction under the organization row lock flips
 * the org to pending and writes the purge row (due at purge_after); two pods racing converge on one row. Everything
 * with I/O (billing, unscheduling, emails) happens after the commit, by the request that actually flipped it.
 */
export async function requestOrganizationDeletion(input: {
  organizationId: string; actorUserId: string; guard: MembershipGuard; graceDays?: number; reason?: "owner" | "admin" | "account_deletion";
}): Promise<DeletionRequestResult> {
  const graceDays = input.graceDays ?? organizationGraceDays();
  const outcome = await db.transaction(async (tx) => {
    await lockTimeout(tx);
    const [org] = await tx.select({
      id: organization.id, pending: organization.deletionRequestedAt, purgeAfter: organization.deletionPurgeAfter,
    }).from(organization).where(eq(organization.id, input.organizationId)).for("update");
    if (!org) return null;
    await assertMembership(tx, input.organizationId, input.guard);
    if (org.pending && org.purgeAfter) return { flipped: false as const, purgeAfter: org.purgeAfter, deletionId: null };
    const [flipped] = await tx.update(organization).set({
      deletionRequestedAt: sql`now()`,
      deletionPurgeAfter: sql`now() + make_interval(days => ${graceDays})`,
      deletionRequestedByUserId: input.actorUserId,
      deletionMeta: {},
    }).where(eq(organization.id, input.organizationId)).returning({ purgeAfter: organization.deletionPurgeAfter });
    // A failed row from an earlier, cancelled cycle would block the unique live-row index; cancel closes them, this is the belt.
    await closeDeletionJobs(tx, "organization", input.organizationId);
    const deletionId = await insertDeletionJob(tx, {
      scope: "organization", targetId: input.organizationId, organizationId: input.organizationId,
      requestedByUserId: input.actorUserId, nextAttemptAt: flipped.purgeAfter!,
    });
    return { flipped: true as const, purgeAfter: flipped.purgeAfter!, deletionId };
  });
  if (!outcome) return null;
  invalidateOrgState(input.organizationId);
  if (!outcome.flipped) return { status: "already", purgeAfter: outcome.purgeAfter, deletionId: null, billing: "skipped" };

  const billing = await settleBillingOnRequest(input.organizationId);
  await logAuditEvent({
    userId: input.actorUserId, organizationId: input.organizationId, action: "organization_deletion_requested", resource: "organization",
    resourceId: input.organizationId, metadata: { purgeAfter: outcome.purgeAfter.toISOString(), reason: input.reason ?? "owner" }, success: true,
  });
  await quiesceOrganization(input.organizationId).catch((error) => console.error("[ORG_DELETION] quiesce failed; the sweep resumes it:", error));
  await sendOrganizationNotice(input.organizationId, "noticeRequested").catch(() => undefined);
  if (new Date(outcome.purgeAfter).getTime() <= Date.now() && outcome.deletionId) await triggerDeletion(outcome.deletionId); // self-hosted grace 0
  return { status: "requested", purgeAfter: outcome.purgeAfter, deletionId: outcome.deletionId, billing };
}

const BILLING_CLAIM_TTL = "2 minutes";

/**
 * After the flip: cancel at period end once, flush usage. A provider outage leaves the marker unsettled and the sweep retries.
 *
 * The attempt is claimed with a committed lease before the provider is called (`billingCancelAttempted` plus a claim time),
 * never inside an open transaction, so a crash after the provider accepted cannot lose it: the retry finds the attempt
 * marker, so an "already" it sees is our own cancellation and cancelling the deletion reinstates the renewal. Only one live
 * claim exists at a time (a second caller gets "retry"), and a claim older than the TTL is a crashed attempt. A caller that
 * is the first to claim sees no earlier attempt, so the owner's own earlier cancellation is never taken for ours.
 */
export async function settleBillingOnRequest(organizationId: string): Promise<"cancelled" | "already" | "none" | "skipped" | "retry"> {
  const [org] = await db.select({ id: organization.id, subscriptionId: organization.subscriptionId, polarCustomerId: organization.polarCustomerId, meta: organization.deletionMeta })
    .from(organization).where(and(eq(organization.id, organizationId), isNotNull(organization.deletionRequestedAt)));
  if (!org) return "skipped";
  const meta = org.meta as DeletionMeta;
  if (meta.billingCancelSettled) return "already";
  const attemptedBefore = !!meta.billingCancelAttempted;
  const hasBilling = !!(org.subscriptionId || org.polarCustomerId);
  if (hasBilling) {
    const [claimed] = await db.update(organization)
      .set({ deletionMeta: sql`${organization.deletionMeta} || jsonb_build_object('billingCancelAttempted', true, 'billingCancelClaimAt', clock_timestamp()::text)` })
      .where(and(
        eq(organization.id, organizationId), isNotNull(organization.deletionRequestedAt), sql`NOT (${organization.deletionMeta} ? 'billingCancelSettled')`,
        sql`(NOT (${organization.deletionMeta} ? 'billingCancelClaimAt') OR (${organization.deletionMeta} ->> 'billingCancelClaimAt')::timestamptz < clock_timestamp() - ${sql.raw(`interval '${BILLING_CLAIM_TTL}'`)})`,
      )).returning({ id: organization.id });
    if (!claimed) return "retry"; // another caller holds a live claim (or the deletion was cancelled / settled meanwhile)
  }
  const savePatch = (patch: DeletionMeta) => db.update(organization).set({ deletionMeta: metaPatch(organization.deletionMeta, patch) })
    .where(and(eq(organization.id, organizationId), isNotNull(organization.deletionRequestedAt))).returning({ id: organization.id });
  const dropClaim = () => db.update(organization).set({ deletionMeta: sql`${organization.deletionMeta} - 'billingCancelClaimAt'` })
    .where(eq(organization.id, organizationId)).catch(() => undefined);
  try {
    // The advisory lock covers only the provider call (a connection that runs nothing else), ordering it against a reinstate.
    const result = await withBillingLock(organizationId, () => cancelSubscriptionAtPeriodEnd(org));
    // Never downgrade billingCancelRequested. "cancelled" is ours; an "already" after an earlier attempt of ours is ours too
    // (that attempt may have died after the provider accepted it); otherwise it is the owner's own cancellation.
    const ours = result.status === "cancelled" || (result.status === "already" && attemptedBefore);
    const stored = await savePatch(ours ? { billingCancelSettled: true, billingCancelRequested: true } : { billingCancelSettled: true, billingCancelAttempted: false });
    // The owner cancelled the deletion while the provider call was in flight: undo the cancellation this call just made.
    if (stored.length === 0 && result.status === "cancelled") {
      try { await withBillingLock(organizationId, () => reinstateSubscription(org)); }
      catch (error) {
        if (!(error instanceof BillingCancellationError)) throw error;
        // The organization is active but renewal is off, and it is no longer pending, so the pending sweep cannot see it:
        // leave a marker the billing sweep retries.
        await db.update(organization).set({ deletionMeta: metaPatch(organization.deletionMeta, { billingReinstatePending: true }) })
          .where(and(eq(organization.id, organizationId), sql`${organization.deletionRequestedAt} IS NULL`));
      }
      return "skipped";
    }
    if (result.status === "cancelled" || result.status === "already") {
      try { await flushFinalUsage(organizationId, { strict: false }); }
      catch (error) { if (!(error instanceof BillingCancellationError)) throw error; return "retry"; }
    }
    return result.status;
  } catch (error) {
    if (!(error instanceof BillingCancellationError)) throw error;
    await dropClaim(); // the attempt marker stays (the provider may have accepted it); the sweep may retry at once
    return "retry";
  }
}

/** Sweep: pending organizations whose billing cancellation did not go through yet. */
export async function retryPendingBillingCancels(limit = 25): Promise<number> {
  const rows = await db.select({ id: organization.id }).from(organization)
    .where(and(isNotNull(organization.deletionRequestedAt), sql`NOT (${organization.deletionMeta} ? 'billingCancelSettled')`, or(isNotNull(organization.subscriptionId), isNotNull(organization.polarCustomerId)))).limit(limit);
  let settled = 0;
  for (const row of rows) if ((await settleBillingOnRequest(row.id)) !== "retry") settled++;
  // Renewal that a cancelled deletion failed to restore: no longer pending, so it carries its own marker.
  const orphans = await db.select({ id: organization.id }).from(organization)
    .where(and(sql`${organization.deletionRequestedAt} IS NULL`, sql`${organization.deletionMeta} ? 'billingReinstatePending'`)).limit(limit);
  for (const row of orphans) {
    const outcome = await withBillingLock(row.id, async (tx) => {
      const [org] = await tx.select({ id: organization.id, subscriptionId: organization.subscriptionId, polarCustomerId: organization.polarCustomerId, pending: organization.deletionRequestedAt })
        .from(organization).where(eq(organization.id, row.id));
      if (!org) return "gone" as const;
      if (!org.pending) {
        try { await reinstateSubscription(org); } catch (error) { if (error instanceof BillingCancellationError) return "retry" as const; throw error; }
      }
      await tx.update(organization).set({ deletionMeta: sql`${organization.deletionMeta} - 'billingReinstatePending'` }).where(eq(organization.id, row.id));
      return "done" as const;
    });
    if (outcome !== "retry") settled++;
  }
  return settled;
}

/**
 * Owner cancels during the window. Refused once the window has passed or the purge has started (decided under the org
 * row lock, the same lock the purge's first step takes). Reinstates a billing cancellation only if this flow made it.
 */
export async function cancelOrganizationDeletion(input: { organizationId: string; actorUserId: string }): Promise<{ billing: "reinstated" | "ended" | "skipped" | "none" | "failed" }> {
  const tooLate = () => new OrganizationDeletionError("The deletion window has ended and the purge has started; it can no longer be cancelled", 409, "PURGE_STARTED");
  // Decide and clear under the organization row lock, the same lock the purge's first step takes: after this commits the
  // purge sees a non-pending organization and does nothing, and before it the purge's stamp makes this refuse.
  const cleared = await db.transaction(async (tx) => {
    await lockTimeout(tx);
    const [org] = await tx.select({
      id: organization.id, subscriptionId: organization.subscriptionId, polarCustomerId: organization.polarCustomerId,
      pending: organization.deletionRequestedAt, expired: sql<boolean>`${organization.deletionPurgeAfter} <= now()`, meta: organization.deletionMeta,
    }).from(organization).where(eq(organization.id, input.organizationId)).for("update");
    if (!org?.pending) throw new OrganizationDeletionError("This organization is not scheduled for deletion", 409, "NOT_PENDING");
    if ((org.meta as DeletionMeta).purgeStartedAt || org.expired) throw tooLate();
    await tx.update(organization).set({ deletionRequestedAt: null, deletionPurgeAfter: null, deletionRequestedByUserId: null, deletionMeta: {} })
      .where(eq(organization.id, input.organizationId));
    await closeDeletionJobs(tx, "organization", input.organizationId);
    return { org: { id: org.id, subscriptionId: org.subscriptionId, polarCustomerId: org.polarCustomerId }, billingCancelRequested: !!((org.meta as DeletionMeta).billingCancelRequested || (org.meta as DeletionMeta).billingCancelAttempted) };
  });
  invalidateOrgState(input.organizationId);

  // After the commit, and only for a cancellation this flow made. The organization is already back to normal, so a provider
  // outage is reported (the owner can restore renewal in the billing portal) instead of undoing the cancel.
  let billing: "reinstated" | "ended" | "skipped" | "none" | "failed" = "none";
  if (cleared.billingCancelRequested) {
    try {
      // Under the billing lock, and only if no new request has made the organization pending again in the meantime.
      billing = await withBillingLock(input.organizationId, async (tx) => {
        const [now] = await tx.select({ pending: organization.deletionRequestedAt }).from(organization).where(eq(organization.id, input.organizationId));
        return now?.pending ? "skipped" as const : reinstateSubscription(cleared.org);
      });
    } catch (error) {
      if (!(error instanceof BillingCancellationError)) throw error;
      billing = "failed";
      await db.update(organization).set({ deletionMeta: metaPatch(organization.deletionMeta, { billingReinstatePending: true }) })
        .where(and(eq(organization.id, input.organizationId), sql`${organization.deletionRequestedAt} IS NULL`)).catch(() => undefined);
    }
  }
  await logAuditEvent({
    userId: input.actorUserId, organizationId: input.organizationId, action: "organization_deletion_cancelled", resource: "organization",
    resourceId: input.organizationId, metadata: { billing }, success: true,
  });
  await rescheduleOrganization(input.organizationId).catch((error) => console.error("[ORG_DELETION] reschedule after cancel failed; schedulers repair on the next start:", error));
  return { billing };
}

/** Super admin (legal erasure): purge now. Audited with the reason. Marks the organization pending first when it is not. */
export async function purgeOrganizationNow(input: { organizationId: string; adminUserId: string; reason: string }): Promise<{ deletionId: string | null; wasPending: boolean } | null> {
  const outcome = await db.transaction(async (tx) => {
    await lockTimeout(tx);
    const [org] = await tx.select({ pending: organization.deletionRequestedAt }).from(organization).where(eq(organization.id, input.organizationId)).for("update");
    if (!org) return null;
    const wasPending = !!org.pending;
    await tx.update(organization).set({
      deletionRequestedAt: sql`coalesce(${organization.deletionRequestedAt}, now())`,
      deletionPurgeAfter: sql`now()`,
      deletionRequestedByUserId: sql`coalesce(${organization.deletionRequestedByUserId}, ${input.adminUserId}::uuid)`,
      deletionMeta: metaPatch(organization.deletionMeta, { forcedByUserId: input.adminUserId }),
    }).where(eq(organization.id, input.organizationId));
    const deletionId = await insertDeletionJob(tx, { scope: "organization", targetId: input.organizationId, organizationId: input.organizationId, requestedByUserId: input.adminUserId, nextAttemptAt: new Date() });
    // The audit record commits with the purge stamp, so an early purge never runs without its reason on record.
    await logAdminEvent(input.adminUserId, "organization_purge_now", input.organizationId, "organization", input.organizationId, { reason: input.reason, wasPending }, tx);
    return { wasPending, deletionId };
  });
  if (!outcome) return null;
  invalidateOrgState(input.organizationId);
  const id = (await expediteDeletionJob("organization", input.organizationId)) ?? outcome.deletionId;
  if (id) await triggerDeletion(id, 0);
  if (!outcome.wasPending) await quiesceOrganization(input.organizationId).catch(() => undefined);
  return { deletionId: id, wasPending: outcome.wasPending };
}

const QUIESCE_BATCH = 100;
const QUIESCE_BUDGET_MS = 20_000;

/**
 * Stop activity of a pending organization in resumable batches: cancel queued and running runs, remove job and monitor
 * schedules. The cursor lives in deletion_meta, so the sweep continues where a slow or crashed request stopped. Late scheduler
 * ticks and worker admission also refuse work for a pending organization, so this is cleanup, not the only guard.
 */
export async function quiesceOrganization(organizationId: string, options: { budgetMs?: number; force?: boolean } = {}): Promise<boolean> {
  const deadline = Date.now() + (options.budgetMs ?? QUIESCE_BUDGET_MS);
  const read = async () => (await db.select({ pending: organization.deletionRequestedAt, meta: organization.deletionMeta }).from(organization).where(eq(organization.id, organizationId)))[0];
  let state = await read();
  if (!state?.pending) return false;
  let meta = state.meta as DeletionMeta;
  if (meta.quiesced && !options.force) return true;
  const save = (patch: DeletionMeta) => db.update(organization).set({ deletionMeta: metaPatch(organization.deletionMeta, patch) })
    .where(and(eq(organization.id, organizationId), isNotNull(organization.deletionRequestedAt)));

  // 1. Runs. Rows that already carry the marker are skipped, so each pass makes progress even while a worker has not claimed them yet.
  for (;;) {
    const active = await db.select({ id: runs.id }).from(runs).innerJoin(projects, eq(projects.id, runs.projectId))
      .where(and(eq(projects.organizationId, organizationId), inArray(runs.status, ["queued", "running"]), or(sql`${runs.errorDetails} IS NULL`, ne(runs.errorDetails, RUN_CANCELLATION_MARKER))))
      .limit(QUIESCE_BATCH);
    if (active.length === 0) break;
    const ids = active.map((run) => run.id);
    // Marked under FOR SHARE on the organization row: a cancel that committed first is seen here, so runs a restored
    // organization has started are never cancelled by this old pass.
    const marked = await db.transaction(async (tx) => {
      await lockTimeout(tx);
      const [current] = await tx.select({ pending: organization.deletionRequestedAt }).from(organization).where(eq(organization.id, organizationId)).for("share");
      if (!current?.pending) return false;
      await tx.update(runs).set({ errorDetails: RUN_CANCELLATION_MARKER }).where(and(inArray(runs.id, ids), inArray(runs.status, ["queued", "running"])));
      return true;
    });
    if (!marked) return false;
    await Promise.allSettled(ids.map((id) => setCancellationSignal(id)));
    if (Date.now() > deadline) return false;
  }
  // 2. Schedules, keyset-paged so a failure keeps the cursor and the next pass retries the same page.
  for (const kind of ["job", "monitor"] as const) {
    for (;;) {
      const after = meta.quiesceAfter?.[kind];
      const page = kind === "job"
        ? await db.select({ id: jobs.id, scheduledId: jobs.scheduledJobId }).from(jobs).where(and(eq(jobs.organizationId, organizationId), after ? gt(jobs.id, after) : undefined)).orderBy(asc(jobs.id)).limit(QUIESCE_BATCH)
        : await db.select({ id: monitors.id, scheduledId: monitors.scheduledJobId }).from(monitors).where(and(eq(monitors.organizationId, organizationId), after ? gt(monitors.id, after) : undefined)).orderBy(asc(monitors.id)).limit(QUIESCE_BATCH);
      if (page.length === 0) break;
      // FOR SHARE on the organization row for the whole page: a cancel (FOR UPDATE) waits for the removals in flight, and one that
      // committed first is seen here as not pending, so cleanup can never remove the schedules a cancel just restored.
      const results = await db.transaction(async (tx) => {
        await lockTimeout(tx);
        const [current] = await tx.select({ pending: organization.deletionRequestedAt }).from(organization).where(eq(organization.id, organizationId)).for("share");
        if (!current?.pending) return null;
        return Promise.all(page.map(async (row) => {
          try {
            if (kind === "job") return await deleteScheduledJob(row.id, { throwOnError: true }), true;
            for (const id of new Set([row.id, row.scheduledId].filter((v): v is string => !!v))) await removeScheduledMonitor(id); // throws on a scheduler failure; false only means nothing was scheduled
            return true;
          } catch { return false; }
        }));
      });
      if (!results) return false;
      if (results.some((ok) => !ok)) return false; // retried by the sweep; the cursor stays on this page
      meta = { ...meta, quiesceAfter: { ...meta.quiesceAfter, [kind]: page[page.length - 1].id } };
      await save({ quiesceAfter: meta.quiesceAfter });
      if (Date.now() > deadline) return false;
    }
  }
  await save({ quiesced: true });
  state = await read();
  return !!state?.pending;
}

/** Sweep: continue unfinished quiescing of pending organizations. */
export async function continueQuiescing(limit = 10): Promise<number> {
  const rows = await db.select({ id: organization.id }).from(organization)
    .where(and(isNotNull(organization.deletionRequestedAt), sql`NOT (${organization.deletionMeta} @> '{"quiesced": true}'::jsonb)`)).limit(limit);
  let done = 0;
  for (const row of rows) if (await quiesceOrganization(row.id)) done++;
  return done;
}

/** After a cancelled deletion: put schedules back for jobs and monitors that should run. */
export async function rescheduleOrganization(organizationId: string): Promise<{ jobs: number; monitors: number }> {
  let rescheduledJobs = 0;
  let rescheduledMonitors = 0;
  for (let after: string | undefined; ;) {
    const page = await db.select({ id: jobs.id, name: jobs.name, cron: jobs.cronSchedule }).from(jobs)
      .where(and(eq(jobs.organizationId, organizationId), isNotNull(jobs.cronSchedule), sql`${jobs.deletingAt} IS NULL`, after ? gt(jobs.id, after) : undefined)).orderBy(asc(jobs.id)).limit(QUIESCE_BATCH);
    if (page.length === 0) break;
    after = page[page.length - 1].id;
    for (const job of page) {
      try {
        const schedulerId = await scheduleJob({ name: job.name, cron: job.cron!, jobId: job.id, retryLimit: 3 });
        await db.update(jobs).set({ scheduledJobId: schedulerId, nextRunAt: getNextRunDate(job.cron!) }).where(eq(jobs.id, job.id));
        rescheduledJobs++;
      } catch (error) { console.error(`[ORG_DELETION] Could not reschedule job ${job.id}:`, error); }
    }
  }
  for (let after: string | undefined; ;) {
    const page = await db.select({ id: monitors.id, projectId: monitors.projectId }).from(monitors)
      .where(and(eq(monitors.organizationId, organizationId), eq(monitors.enabled, true), ne(monitors.status, "paused"), sql`${monitors.deletingAt} IS NULL`, after ? gt(monitors.id, after) : undefined)).orderBy(asc(monitors.id)).limit(QUIESCE_BATCH);
    if (page.length === 0) break;
    after = page[page.length - 1].id;
    for (const monitor of page) {
      if (!monitor.projectId) continue;
      try { await reconcileMonitorSchedule(monitor.id, monitor.projectId); rescheduledMonitors++; }
      catch (error) { console.error(`[ORG_DELETION] Could not reschedule monitor ${monitor.id}:`, error); }
    }
  }
  return { jobs: rescheduledJobs, monitors: rescheduledMonitors };
}

export type OrganizationDeletionState = {
  pending: boolean;
  requestedAt: Date | null;
  purgeAfter: Date | null;
  requestedByUserId: string | null;
  /** The owner can still cancel (window not over, purge not started). */
  canCancel: boolean;
  purge: { state: string; phase: string | null; lastError: string | null } | null;
  graceDays: number;
  /** False: no mail is sent, so the UI confirms in-app only. */
  emailAvailable: boolean;
  selfHosted: boolean;
  hasSubscription: boolean;
};

export async function getOrganizationDeletionState(organizationId: string): Promise<OrganizationDeletionState | null> {
  const [org] = await db.select({
    requestedAt: organization.deletionRequestedAt, purgeAfter: organization.deletionPurgeAfter, by: organization.deletionRequestedByUserId,
    meta: organization.deletionMeta, subscriptionId: organization.subscriptionId,
  }).from(organization).where(eq(organization.id, organizationId));
  if (!org) return null;
  const [purge] = org.requestedAt
    ? await db.select({ state: deletionJobs.state, phase: deletionJobs.phase, lastError: deletionJobs.lastError }).from(deletionJobs)
      .where(and(eq(deletionJobs.scope, "organization"), eq(deletionJobs.targetId, organizationId), ne(deletionJobs.state, "completed"))).limit(1)
    : [];
  const started = !!(org.meta as DeletionMeta).purgeStartedAt;
  return {
    pending: !!org.requestedAt, requestedAt: org.requestedAt, purgeAfter: org.purgeAfter, requestedByUserId: org.by,
    canCancel: !!org.requestedAt && !started && !!org.purgeAfter && org.purgeAfter.getTime() > Date.now(),
    purge: purge ?? null, graceDays: organizationGraceDays(), emailAvailable: isEmailConfigured(), selfHosted: isSelfHosted(),
    hasSubscription: hasCancellableSubscription({ subscriptionId: org.subscriptionId }),
  };
}

/** Organizations whose only member is this user (deleted together with the user). */
export async function soleMemberOrganizations(userId: string) {
  const rows = await db.select({ id: organization.id, name: organization.name, subscriptionId: organization.subscriptionId, pending: organization.deletionRequestedAt })
    .from(member).innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(eq(member.userId, userId), sql`not exists (select 1 from member other where other.organization_id = ${member.organizationId} and other.user_id <> ${userId})`));
  return rows.map(({ subscriptionId, pending, ...org }) => ({ ...org, hasActiveSubscription: hasCancellableSubscription({ subscriptionId }), alreadyPending: !!pending }));
}
