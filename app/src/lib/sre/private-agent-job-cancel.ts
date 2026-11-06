import { and, eq } from "drizzle-orm";

import { privateAgentJobs } from "@/db/schema";
import { db } from "@/utils/db";

/** Cancels a job nobody is waiting for any more, so it cannot run late. Leased or finished jobs are left alone. */
export async function cancelQueuedPrivateAgentJob(input: {
  jobId: string;
  organizationId: string;
  projectId: string;
}) {
  await db
    .update(privateAgentJobs)
    .set({ status: "cancelled", completedAt: new Date(), errorCode: "wait_abandoned" })
    .where(
      and(
        eq(privateAgentJobs.id, input.jobId),
        eq(privateAgentJobs.organizationId, input.organizationId),
        eq(privateAgentJobs.projectId, input.projectId),
        eq(privateAgentJobs.status, "queued"),
      ),
    );
}
