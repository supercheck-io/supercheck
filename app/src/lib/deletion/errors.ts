/** SQLSTATE raised by the runs insert trigger (migration 0074) when the job is being deleted. */
export const JOB_DELETING_SQLSTATE = "DL001";

/** A run insert lost the race with a job deletion (drizzle wraps the driver error, so look at the cause too). */
export function isJobDeletingError(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === JOB_DELETING_SQLSTATE || e?.cause?.code === JOB_DELETING_SQLSTATE;
}
