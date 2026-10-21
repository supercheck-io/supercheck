"use server";

import { runHistoryFields, runReportType } from "@/lib/run-history";
import { db } from "@/utils/db";
import { runs, reports, jobs, jobTests, projects, tests } from "@/db/schema";
import type { JobType } from "@/db/schema";
import { eq, and, count, sql } from "drizzle-orm";
import {
  requireAuth,
  getUserRole,
  hasPermissionForUser,
} from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions";

// Type based on the actual API response from /api/runs/[runId]
type RunResponse = {
  id: string;
  jobId: string | null;
  jobName?: string | undefined;
  projectName?: string | undefined;
  jobType?: JobType;
  status: string;
  duration?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  logs?: string | null;
  errorDetails?: string | null;
  reportUrl?: string | null;
  timestamp?: string;
  testCount?: number;
  trigger?: string;
  location?: string | null;
};

export async function getRun(
  runId: string
): Promise<RunResponse | null> {
  try {
    if (!runId) {
      throw new Error("Missing run ID");
    }

    // Check authentication
    const { userId } = await requireAuth();

    // First, find the run and its associated job/project without filtering by active project
    const result = await db
      .select({
        id: runs.id,
        jobId: runs.jobId,
        ...runHistoryFields,
        projectName: projects.name,
        status: runs.status,
        durationMs: runs.durationMs,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        logs: runs.logs,
        errorDetails: runs.errorDetails,
        trigger: runs.trigger,
        location: runs.location,
        projectId: projects.id,
        organizationId: projects.organizationId,
      })
      .from(runs)
      .leftJoin(jobs, eq(runs.jobId, jobs.id))
      .leftJoin(projects, sql`${projects.id} = coalesce(${runs.projectId}, ${jobs.projectId})`)
      .leftJoin(tests, and(sql`${tests.id}::text = ${runs.metadata}->>'testId'`, eq(tests.projectId, projects.id)))
      .leftJoin(
        reports,
        and(
          sql`${reports.entityId} = ${runs.id}::text`,
          eq(reports.entityType, runReportType)
        )
      )
      .where(eq(runs.id, runId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const run = result[0];

    // Check if user has access to this run's organization
    const userRole = await getUserRole(userId);

    if (!run.organizationId || !run.projectId) return null;
    if (userRole !== Role.SUPER_ADMIN) {
      const canView = await hasPermissionForUser(userId, "run", "view", {
        organizationId: run.organizationId,
        projectId: run.projectId,
      });

      if (!canView) {
        throw new Error("Access denied: Insufficient permissions to view this run");
      }
    }

    // Get test count for this job (if associated with a job)
    let testCount = run.jobId ? 0 : 1;
    if (run.jobId) {
      const testCountResult = await db
        .select({ count: count() })
        .from(jobTests)
        .where(eq(jobTests.jobId, run.jobId));

      testCount = testCountResult[0]?.count || 0;
    }

    const computeDuration = () => {
      // Use durationMs if available
      if (run.durationMs !== null && run.durationMs !== undefined && run.durationMs > 0) {
        const seconds = Math.round(run.durationMs / 1000);
        if (seconds >= 60) {
          const minutes = Math.floor(seconds / 60);
          const remainder = seconds % 60;
          return `${minutes}m${remainder ? ` ${remainder}s` : ""}`.trim();
        }
        if (seconds === 0) {
          return "<1s";
        }
        return `${seconds}s`;
      }
      // Fallback to calculating from timestamps
      if (run.startedAt && run.completedAt) {
        const start = run.startedAt.getTime();
        const end = run.completedAt.getTime();
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
          const seconds = Math.round((end - start) / 1000);
          if (seconds >= 60) {
            const minutes = Math.floor(seconds / 60);
            const remainder = seconds % 60;
            return `${minutes}m${remainder ? ` ${remainder}s` : ""}`.trim();
          }
          if (seconds === 0) {
            return "<1s";
          }
          if (seconds > 0) {
            return `${seconds}s`;
          }
        }
      }
      return null;
    };

    const response: RunResponse = {
      ...run,
      jobName: run.jobName || undefined,
      projectName: run.projectName || undefined,
      jobType: run.jobType || undefined,
      duration: computeDuration(),
      startedAt: run.startedAt?.toISOString() || null,
      completedAt: run.completedAt?.toISOString() || null,
      location: run.location || null,
      testCount,
    };

    return response;
  } catch (error) {
    console.error("Error fetching run:", error);
    throw new Error("Failed to fetch run");
  }
}
