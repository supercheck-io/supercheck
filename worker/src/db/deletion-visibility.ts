// Worker twin of app/src/lib/deletion/visibility.ts: targets being deleted (deleting_at set) are skipped, never acted on.
import { isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { jobs } from './schema/job';
import { monitors } from './schema/monitor';

export const liveMonitor = (table: { deletingAt: AnyColumn } = monitors): SQL =>
  isNull(table.deletingAt);

export const liveJob = (table: { deletingAt: AnyColumn } = jobs): SQL =>
  isNull(table.deletingAt);

/** The run's parent job is not being deleted; a run without a job stays visible. */
export const liveRunOfLiveJob = (jobId: AnyColumn): SQL =>
  sql`(${jobId} IS NULL OR NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.id = ${jobId} AND jobs.deleting_at IS NOT NULL))`;
