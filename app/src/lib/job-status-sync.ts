import { eq, sql } from "drizzle-orm";
import type { db } from "@/utils/db";
import { jobs } from "@/db/schema";
import type { JobStatus } from "@/db/schema";

/**
 * Recompute a job's stored status from its runs in one statement: running while any run is queued
 * or running, otherwise the newest finished run's status (blocked counts as error). With no runs the
 * status resets to pending; with only non-final runs it is left unchanged. Call after the triggering run row is written or deleted.
 */
export async function syncJobStatusFromRuns(
  tx: Pick<typeof db, "update">,
  jobId: string,
): Promise<void> {
  await tx
    .update(jobs)
    .set({
      status: sql<JobStatus>`CASE
        WHEN EXISTS (SELECT 1 FROM runs WHERE job_id = ${jobId} AND status IN ('queued', 'running')) THEN 'running'
        ELSE COALESCE(
          (SELECT CASE WHEN status = 'blocked' THEN 'error' ELSE status END
             FROM runs
            WHERE job_id = ${jobId} AND status IN ('passed', 'failed', 'error', 'blocked')
            ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1),
          CASE WHEN EXISTS (SELECT 1 FROM runs WHERE job_id = ${jobId}) THEN jobs.status ELSE 'pending' END)
      END`,
    })
    .where(eq(jobs.id, jobId));
}
