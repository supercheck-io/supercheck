import { sql } from "drizzle-orm";
import { jobs, reports, runs, tests } from "@/db/schema";
import type { JobType } from "@/db/schema";

export const runHistoryFields = {
  jobName: sql<string>`case when ${runs.jobId} is not null then coalesce(${jobs.name}, 'Deleted job') else coalesce(${tests.title}, 'Deleted test') end`,
  jobType: sql<JobType>`coalesce(${jobs.jobType}, case when ${runs.metadata}->>'testType' = 'performance' then 'k6' else 'playwright' end)`,
  reportUrl: sql<string | null>`coalesce(${reports.s3Url}, ${runs.reportS3Url})`,
};

// Match one report type per execution so joins preserve pagination and totals.
export const runReportType = sql`case when ${runs.jobId} is not null
  then case when ${jobs.jobType} = 'k6' then 'k6_job' else 'job' end
  else case when ${runs.metadata}->>'testType' = 'performance' then 'k6_test' else 'test' end end`;
