"use server";

import { db } from "../utils/db";
import { jobs as jobsTable, jobsSelectSchema } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { scheduleJob } from "../lib/job-scheduler";
import { z } from "zod";
import { validateJobCron } from "@/lib/job-cron-validation";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";

type Job = z.infer<typeof jobsSelectSchema>;

interface ScheduleJobResponse {
  success: boolean;
  error?: string;
  scheduleName?: string;
}

interface GetJobResponse {
  success: boolean;
  job?: Job;
  error?: string;
}

/**
 * Local function to get a job by ID with project scoping
 */
async function getJob(
  jobId: string,
  projectId: string,
  organizationId: string
): Promise<GetJobResponse> {
  try {
    const job = await db
      .select()
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.id, jobId),
          eq(jobsTable.projectId, projectId),
          eq(jobsTable.organizationId, organizationId)
        )
      )
      .limit(1);

    if (job.length === 0) {
      return {
        success: false,
        error: "Job not found or access denied",
      };
    }

    return {
      success: true,
      job: job[0],
    };
  } catch (error) {
    console.error("Error getting job:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get job",
    };
  }
}

/**
 * Server action to schedule a job with BullMQ using cron
 */
export async function scheduleCronJob(
  jobId: string,
  cronExpression: string
): Promise<ScheduleJobResponse> {
  try {
    // Get current project context (includes auth verification)
    const { userId, project, organizationId } = await requireProjectContext();

    // Check permission to update jobs (optimized - reuses context from requireProjectContext)
    const canEditJobs = checkPermissionWithContext("job", "update", {
      userId,
      organizationId,
      project,
    });

    if (!canEditJobs) {
      console.warn(
        `User ${userId} attempted to schedule job ${jobId} without EDIT_JOBS permission`
      );
      return {
        success: false,
        error: "Insufficient permissions to schedule jobs",
      };
    }

    // Validate cron expression
    if (typeof cronExpression !== "string" || !cronExpression.trim()) {
      return {
        success: false,
        error: "Cron expression is required",
      };
    }
    cronExpression = cronExpression.trim();
    const cronError = validateJobCron(cronExpression);
    if (cronError) return { success: false, error: cronError };

    // Get job details with project scoping
    const jobResult = await getJob(jobId, project.id, organizationId);
    if (!jobResult.success || !jobResult.job) {
      return {
        success: false,
        error: "Job not found or access denied",
      };
    }

    const job = jobResult.job;

    // Schedule the job in BullMQ
    const scheduleName = await scheduleJob({
      name: job.name,
      cron: cronExpression,
      timezone: "UTC", // Could make this configurable in the future
      jobId: jobId,
      retryLimit: 1,
    });

    // Update job in the database with next run details
    await db
      .update(jobsTable)
      .set({
        scheduledJobId: scheduleName,
        updatedAt: new Date(),
      })
      .where(eq(jobsTable.id, jobId));

    return {
      success: true,
      scheduleName,
    };
  } catch (error) {
    console.error("Error scheduling job:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to schedule job",
    };
  }
}
