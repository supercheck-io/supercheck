"use server";

import { db } from "@/utils/db";
import { runs, reports, jobs, jobTests, projects } from "@/db/schema";
import { eq, and, count, sql } from "drizzle-orm";
import {
  requireAuth,
  getUserRole,
  getUserOrgRole,
} from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions";

// Type based on the actual API response from /api/runs/[runId]
type RunResponse = {
  id: string;
  jobId: string;
  jobName?: string | undefined;
  projectName?: string | undefined;
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
};

export async function getRun(
  runId: string,
  isNotificationView: boolean = false
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
        jobName: jobs.name,
        projectName: projects.name,
        status: runs.status,
        duration: runs.duration,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        logs: runs.logs,
        errorDetails: runs.errorDetails,
        reportUrl: reports.s3Url,
        trigger: runs.trigger,
        projectId: jobs.projectId,
        organizationId: jobs.organizationId,
      })
      .from(runs)
      .leftJoin(jobs, eq(runs.jobId, jobs.id))
      .leftJoin(projects, eq(jobs.projectId, projects.id))
      .leftJoin(
        reports,
        and(
          sql`${reports.entityId} = ${runs.id}::text`,
          eq(reports.entityType, "job")
        )
      )
      .where(eq(runs.id, runId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const run = result[0];

    // Check if user has access to this run's organization
    // Skip org access checks for notification views (read-only access)
    if (!isNotificationView) {
      const userRole = await getUserRole(userId);

      if (userRole !== Role.SUPER_ADMIN && run.organizationId) {
        const orgRole = await getUserOrgRole(userId, run.organizationId);

        if (!orgRole) {
          throw new Error("Access denied: Not a member of this organization");
        }
      }
    }

    // Get test count for this job
    const testCountResult = await db
      .select({ count: count() })
      .from(jobTests)
      .where(eq(jobTests.jobId, run.jobId));

    const testCount = testCountResult[0]?.count || 0;

    const response: RunResponse = {
      ...run,
      jobName: run.jobName || undefined,
      projectName: run.projectName || undefined,
      startedAt: run.startedAt?.toISOString() || null,
      completedAt: run.completedAt?.toISOString() || null,
      testCount,
    };

    return response;
  } catch (error) {
    console.error("Error fetching run:", error);
    throw new Error("Failed to fetch run");
  }
}
