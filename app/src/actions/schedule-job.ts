"use server";

import { db } from "../utils/db";
import { jobs as jobsTable, jobsSelectSchema } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { scheduleJob } from "../lib/job-scheduler";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";

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

    // Check permission to update jobs
    const canEditJobs = await hasPermission("job", "update", {
      organizationId,
      projectId: project.id,
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
    if (!cronExpression) {
      return {
        success: false,
        error: "Cron expression is required",
      };
    }

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

/**
 * Server action to cancel a scheduled job
 */
export async function cancelScheduledJob(
  jobId: string
): Promise<ScheduleJobResponse> {
  try {
    // Get current project context (includes auth verification)
    const { userId, project, organizationId } = await requireProjectContext();

    // Check permission to update jobs
    const canEditJobs = await hasPermission("job", "update", {
      organizationId,
      projectId: project.id,
    });

    if (!canEditJobs) {
      console.warn(
        `User ${userId} attempted to cancel scheduled job ${jobId} without EDIT_JOBS permission`
      );
      return {
        success: false,
        error: "Insufficient permissions to cancel scheduled jobs",
      };
    }

    // Get the job to find its scheduledJobId with project scoping
    const jobResult = await getJob(jobId, project.id, organizationId);
    if (!jobResult.success || !jobResult.job) {
      console.warn(
        `Cannot cancel schedule for job ${jobId}: Job not found or access denied`
      );
      // Return success:true to allow job deletion to continue
      return {
        success: true,
        error: "Job not found or access denied",
      };
    }

    const job = jobResult.job;
    if (!job.scheduledJobId) {
      console.log(`Job ${jobId} has no scheduled job to cancel`);
      return {
        success: true,
        error: "Job is not scheduled",
      };
    }

    try {
      // Import deleteScheduledJob dynamically to avoid circular imports
      const { deleteScheduledJob } = await import("../lib/job-scheduler");
      const deleted = await deleteScheduledJob(job.scheduledJobId);

      if (!deleted) {
        console.warn(`Failed to delete scheduled job ${job.scheduledJobId}`);
        // Still update the database to remove the reference
      }
    } catch (deleteError) {
      console.error("Error deleting scheduled job:", deleteError);
      // Continue with DB update even if BullMQ deletion fails
    }

    // Update the job in the database to remove the scheduledJobId
    try {
      await db
        .update(jobsTable)
        .set({
          scheduledJobId: null,
          updatedAt: new Date(),
        })
        .where(eq(jobsTable.id, jobId));
    } catch (dbError) {
      console.error("Error updating job in database:", dbError);
      // Still return success since the schedule might be removed
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error("Error canceling scheduled job:", error);
    // Return success to allow job deletion to proceed anyway
    return {
      success: true,
      error: "Failed to cancel scheduled job, but job deletion can proceed",
    };
  }
}
