import { and, eq, sql } from "drizzle-orm";

import { privateAgentJobs } from "@/db/schema";
import { db } from "@/utils/db";

const ABANDONED_CODE = "wait_abandoned";

type JobRef = { jobId: string; organizationId: string; projectId: string };

const scoped = (input: JobRef) =>
  and(
    eq(privateAgentJobs.id, input.jobId),
    eq(privateAgentJobs.organizationId, input.organizationId),
    eq(privateAgentJobs.projectId, input.projectId),
  );

/**
 * Called when a waiter's bounded wait ends without a result. In one statement it leaves the waiters and, when it
 * was the last one and the job is still queued, cancels it so it cannot run late. Returns whether the job was
 * cancelled; false means another caller still waits, or an agent already leased it (read-only, may still finish).
 */
export async function releasePrivateAgentJobWaiter(input: JobRef): Promise<boolean> {
  const last = sql`${privateAgentJobs.waiters} <= 1 AND ${privateAgentJobs.status} = 'queued'`;
  const [row] = await db
    .update(privateAgentJobs)
    .set({
      waiters: sql`GREATEST(${privateAgentJobs.waiters} - 1, 0)`,
      status: sql`CASE WHEN ${last} THEN 'cancelled' ELSE ${privateAgentJobs.status} END`,
      completedAt: sql`CASE WHEN ${last} THEN now() ELSE ${privateAgentJobs.completedAt} END`,
      errorCode: sql`CASE WHEN ${last} THEN ${ABANDONED_CODE} ELSE ${privateAgentJobs.errorCode} END`,
    })
    .where(scoped(input))
    .returning({ status: privateAgentJobs.status, errorCode: privateAgentJobs.errorCode });
  return row?.status === "cancelled" && row.errorCode === ABANDONED_CODE;
}

/**
 * A caller that reuses an existing job through its idempotency key joins it in one statement, so it cannot interleave
 * with the last waiter's cancel. The idempotency key is global and survives a cancel, so a job cancelled as abandoned
 * is put back in the queue (fresh created_at so it is not aged out) with this caller as its only waiter; any other job just gains a waiter.
 */
export async function joinPrivateAgentJob(input: JobRef) {
  const revive = sql`${privateAgentJobs.status} = 'cancelled' AND ${privateAgentJobs.errorCode} = ${ABANDONED_CODE}`;
  const cleared = <T>(column: T) => sql`CASE WHEN ${revive} THEN NULL ELSE ${column} END`;
  await db
    .update(privateAgentJobs)
    .set({
      status: sql`CASE WHEN ${revive} THEN 'queued' ELSE ${privateAgentJobs.status} END`,
      waiters: sql`CASE WHEN ${revive} THEN 1 ELSE ${privateAgentJobs.waiters} + 1 END`,
      leaseTokenHash: cleared(privateAgentJobs.leaseTokenHash),
      leaseExpiresAt: cleared(privateAgentJobs.leaseExpiresAt),
      startedAt: cleared(privateAgentJobs.startedAt),
      completedAt: cleared(privateAgentJobs.completedAt),
      durationMs: cleared(privateAgentJobs.durationMs),
      errorCode: cleared(privateAgentJobs.errorCode),
      resultHash: cleared(privateAgentJobs.resultHash),
      resultSummary: cleared(privateAgentJobs.resultSummary),
      cancelRequestedAt: cleared(privateAgentJobs.cancelRequestedAt),
      createdAt: sql`CASE WHEN ${revive} THEN now() ELSE ${privateAgentJobs.createdAt} END`,
    })
    .where(scoped(input));
}
