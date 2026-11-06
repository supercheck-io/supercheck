import { and, eq } from "drizzle-orm";

import { privateAgentJobs } from "@/db/schema";
import { db } from "@/utils/db";

const ABANDONED_CODE = "wait_abandoned";

/** Cancels a job nobody is waiting for any more, so it cannot run late. Leased or finished jobs are left alone. */
export async function cancelQueuedPrivateAgentJob(input: {
  jobId: string;
  organizationId: string;
  projectId: string;
}) {
  await db
    .update(privateAgentJobs)
    .set({ status: "cancelled", completedAt: new Date(), errorCode: ABANDONED_CODE })
    .where(
      and(
        eq(privateAgentJobs.id, input.jobId),
        eq(privateAgentJobs.organizationId, input.organizationId),
        eq(privateAgentJobs.projectId, input.projectId),
        eq(privateAgentJobs.status, "queued"),
      ),
    );
}

/**
 * The idempotency key is global and survives a cancel, so an identical later request lands on the cancelled
 * row. Put it back in the queue (fresh created_at so it is not aged out) when we cancelled it as abandoned.
 */
export async function requeueAbandonedPrivateAgentJob(input: {
  jobId: string;
  organizationId: string;
  projectId: string;
}) {
  await db
    .update(privateAgentJobs)
    .set({ status: "queued", completedAt: null, errorCode: null, startedAt: null, createdAt: new Date() })
    .where(
      and(
        eq(privateAgentJobs.id, input.jobId),
        eq(privateAgentJobs.organizationId, input.organizationId),
        eq(privateAgentJobs.projectId, input.projectId),
        eq(privateAgentJobs.status, "cancelled"),
        eq(privateAgentJobs.errorCode, ABANDONED_CODE),
      ),
    );
}
