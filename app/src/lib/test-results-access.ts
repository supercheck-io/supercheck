import { db } from "@/utils/db";
import {
  jobs,
  k6PerformanceRuns,
  monitors,
  monitorResults,
  runs,
  tests,
  projects,
} from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";

export type AccessContext = {
  organizationId: string | null;
  projectId: string | null;
};

/**
 * Resolve org/project ownership for a report entity.
 * Kept outside route.ts — Next.js only allows HTTP method exports from route modules.
 */
export async function resolveAccessContext(
  entityType: string,
  entityId: string
): Promise<AccessContext | null> {
  try {
    if (entityType === "test") {
      // Prefer the persisted run id (modern playground + saved-test executions).
      const runResult = await db
        .select({
          organizationId: projects.organizationId,
          projectId: runs.projectId,
        })
        .from(runs)
        .leftJoin(projects, eq(projects.id, runs.projectId))
        .where(eq(runs.id, entityId))
        .limit(1);

      if (runResult.length) {
        return {
          organizationId: runResult[0].organizationId,
          projectId: runResult[0].projectId,
        };
      }

      // Playground historically keyed reports by an ephemeral testId while the
      // owning run stored that id in metadata.testId. Resolve ownership from
      // that run — never from the caller's current project.
      const playgroundRunResult = await db
        .select({
          organizationId: projects.organizationId,
          projectId: runs.projectId,
        })
        .from(runs)
        .leftJoin(projects, eq(projects.id, runs.projectId))
        .where(sql`${runs.metadata}->>'testId' = ${entityId}`)
        .orderBy(desc(runs.createdAt))
        .limit(1);

      if (playgroundRunResult.length) {
        return {
          organizationId: playgroundRunResult[0].organizationId,
          projectId: playgroundRunResult[0].projectId,
        };
      }

      // Saved tests still publish reports under tests.id for some paths.
      const result = await db
        .select({
          organizationId: tests.organizationId,
          projectId: tests.projectId,
        })
        .from(tests)
        .where(eq(tests.id, entityId))
        .limit(1);

      if (!result.length) return null;
      return {
        organizationId: result[0].organizationId,
        projectId: result[0].projectId,
      };
    }

    if (entityType === "job") {
      const result = await db
        .select({
          organizationId: jobs.organizationId,
          projectId: runs.projectId,
        })
        .from(runs)
        .leftJoin(jobs, eq(jobs.id, runs.jobId))
        .where(eq(runs.id, entityId))
        .limit(1);

      if (!result.length) return null;
      return {
        organizationId: result[0].organizationId,
        projectId: result[0].projectId,
      };
    }

    if (entityType === "k6_test" || entityType === "k6_job") {
      const result = await db
        .select({
          organizationId: k6PerformanceRuns.organizationId,
          projectId: k6PerformanceRuns.projectId,
        })
        .from(k6PerformanceRuns)
        .where(eq(k6PerformanceRuns.runId, entityId))
        .limit(1);

      if (!result.length) return null;
      return {
        organizationId: result[0].organizationId,
        projectId: result[0].projectId,
      };
    }

    if (entityType === "monitor") {
      const result = await db
        .select({
          organizationId: monitors.organizationId,
          projectId: monitors.projectId,
        })
        .from(monitorResults)
        .leftJoin(monitors, eq(monitors.id, monitorResults.monitorId))
        .where(eq(monitorResults.testExecutionId, entityId))
        .limit(1);

      if (result.length) {
        return {
          organizationId: result[0].organizationId,
          projectId: result[0].projectId,
        };
      }

      const monitorRecord = await db
        .select({
          organizationId: monitors.organizationId,
          projectId: monitors.projectId,
        })
        .from(monitors)
        .where(eq(monitors.id, entityId))
        .limit(1);

      if (!monitorRecord.length) return null;
      return {
        organizationId: monitorRecord[0].organizationId,
        projectId: monitorRecord[0].projectId,
      };
    }

    return null;
  } catch (error) {
    console.error("[TEST-RESULTS] Error resolving access context:", error);
    return null;
  }
}

export function getReportCacheControl(): string {
  return "private, no-store, no-cache, must-revalidate";
}
