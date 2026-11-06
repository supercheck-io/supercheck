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

/** A caller that reuses an existing job through its idempotency key joins its waiters (the inserting caller starts at 1). */
export async function registerPrivateAgentJobWaiter(input: JobRef) {
  await db
    .update(privateAgentJobs)
    .set({ waiters: sql`${privateAgentJobs.waiters} + 1` })
    .where(scoped(input));
}

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
 * The idempotency key is global and survives a cancel, so an identical later request lands on the cancelled
 * row. Put it back in the queue (fresh created_at so it is not aged out, no waiters) when we cancelled it as abandoned.
 */
export async function requeueAbandonedPrivateAgentJob(input: JobRef) {
  await db
    .update(privateAgentJobs)
    .set({
      status: "queued",
      waiters: 0,
      leaseTokenHash: null,
      leaseExpiresAt: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      errorCode: null,
      resultHash: null,
      resultSummary: null,
      cancelRequestedAt: null,
      createdAt: new Date(),
    })
    .where(
      and(scoped(input), eq(privateAgentJobs.status, "cancelled"), eq(privateAgentJobs.errorCode, ABANDONED_CODE)),
    );
}
