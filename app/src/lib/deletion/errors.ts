/** SQLSTATE raised by the insert triggers of migration 0074 (runs of a deleting job, status page links of a deleting monitor). */
export const JOB_DELETING_SQLSTATE = "DL001";

/** An insert lost the race with a job or monitor deletion (drizzle wraps the driver error, so look at the cause too). */
export function isDeletingError(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === JOB_DELETING_SQLSTATE || e?.cause?.code === JOB_DELETING_SQLSTATE;
}
