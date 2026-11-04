import { and, desc, eq, inArray } from "drizzle-orm";
import type { db } from "@/utils/db";
import { jobs, runs } from "@/db/schema";
import type { JobStatus } from "@/db/schema";

/** A job shows "running" while any run is active, otherwise its newest finished run's status. */
export function jobStatusFromRuns(
  hasActiveRun: boolean,
  newestFinished: JobStatus | undefined,
): JobStatus {
  if (hasActiveRun) return "running";
  return newestFinished ?? "pending";
}

export async function syncJobStatusFromRuns(
  tx: Pick<typeof db, "select" | "update">,
  jobId: string,
): Promise<JobStatus> {
  const [active] = await tx
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.jobId, jobId), inArray(runs.status, ["queued", "running"])))
    .limit(1);
  const [latest] = await tx
    .select({ status: runs.status })
    .from(runs)
    .where(and(eq(runs.jobId, jobId), inArray(runs.status, ["passed", "failed", "error"])))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  const status = jobStatusFromRuns(!!active, latest?.status as JobStatus | undefined);
  await tx.update(jobs).set({ status }).where(eq(jobs.id, jobId));
  return status;
}
