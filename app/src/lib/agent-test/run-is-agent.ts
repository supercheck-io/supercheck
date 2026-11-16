import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { db } from "@/utils/db";
import { jobTests, tests } from "@/db/schema";
import { isUuid } from "@/lib/uuid";

/** True when the run is a playground agent run (no tests row, `metadata.testType`), a single agent test run or a job run with an agent test in it, scoped to the run's project. */
export async function isAgentRun(run: { jobId: string | null; testId?: unknown; testType?: unknown; projectId: string }): Promise<boolean> {
  if (run.testType === "agent") return true;
  const members: SQL[] = [];
  if (run.jobId) members.push(inArray(tests.id, db.select({ id: jobTests.testId }).from(jobTests).where(eq(jobTests.jobId, run.jobId))));
  if (typeof run.testId === "string" && isUuid(run.testId)) members.push(eq(tests.id, run.testId));
  if (members.length === 0) return false;
  const [row] = await db
    .select({ id: tests.id })
    .from(tests)
    .where(and(eq(tests.projectId, run.projectId), eq(tests.type, "agent"), or(...members)))
    .limit(1);
  return Boolean(row);
}
