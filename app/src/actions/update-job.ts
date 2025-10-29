"use server";

import { db } from "@/utils/db";
import { jobs, jobTests, jobNotificationSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { scheduleJob, deleteScheduledJob } from "@/lib/job-scheduler";
import { getNextRunDate } from "@/lib/cron-utils";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";

const updateJobSchema = z.object({
  jobId: z.string().uuid(),
  name: z.string(),
  description: z.string().optional().default(""),
  cronSchedule: z.string().optional(),
  tests: z.array(
    z.object({
      id: z.string().uuid(),
    })
  ),
  alertConfig: z
    .object({
      enabled: z.boolean(),
      notificationProviders: z.array(z.string()),
      alertOnFailure: z.boolean(),
      alertOnSuccess: z.boolean().optional(),
      alertOnTimeout: z.boolean().optional(),
      failureThreshold: z.number(),
      recoveryThreshold: z.number(),
      customMessage: z.string().optional(),
    })
    .optional(),
});

export type UpdateJobData = z.infer<typeof updateJobSchema>;

export async function updateJob(data: UpdateJobData) {
  console.log(`Updating job ${data.jobId}`);

  try {
    // Get current project context (includes auth verification)
    const { userId, project, organizationId } = await requireProjectContext();

    // Check EDIT_JOBS permission
    const canEditJobs = await hasPermission("job", "update", {
      organizationId,
      projectId: project.id,
    });

    if (!canEditJobs) {
      console.warn(
        `User ${userId} attempted to update job ${data.jobId} without EDIT_JOBS permission`
      );
      return {
        success: false,
        message: "Insufficient permissions to edit jobs",
      };
    }

    // Validate the data
    const validatedData = updateJobSchema.parse(data);

    // Validate alert configuration if enabled
    if (validatedData.alertConfig?.enabled) {
      // Check if at least one notification provider is selected
      if (
        !validatedData.alertConfig.notificationProviders ||
        validatedData.alertConfig.notificationProviders.length === 0
      ) {
        return {
          success: false,
          error:
            "At least one notification channel must be selected when alerts are enabled",
        };
      }

      // Check notification channel limit
      const maxJobChannels = parseInt(
        process.env.NEXT_PUBLIC_MAX_JOB_NOTIFICATION_CHANNELS || "10",
        10
      );
      if (
        validatedData.alertConfig.notificationProviders.length > maxJobChannels
      ) {
        return {
          success: false,
          error: `You can only select up to ${maxJobChannels} notification channels`,
        };
      }

      // Check if at least one alert type is selected
      const alertTypesSelected = [
        validatedData.alertConfig.alertOnFailure,
        validatedData.alertConfig.alertOnSuccess,
        validatedData.alertConfig.alertOnTimeout,
      ].some(Boolean);

      if (!alertTypesSelected) {
        return {
          success: false,
          error:
            "At least one alert type must be selected when alerts are enabled",
        };
      }
    }

    const dbInstance = db;

    // Check if the job exists and user has access to it (project scoped)
    const existingJob = await dbInstance
      .select({
        id: jobs.id,
        name: jobs.name,
        createdByUserId: jobs.createdByUserId,
        cronSchedule: jobs.cronSchedule,
        scheduledJobId: jobs.scheduledJobId,
        projectId: jobs.projectId,
        organizationId: jobs.organizationId,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.id, validatedData.jobId),
          eq(jobs.projectId, project.id),
          eq(jobs.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!existingJob || existingJob.length === 0) {
      return {
        success: false,
        message: `Job with ID ${validatedData.jobId} not found or access denied`,
      };
    }

    const job = existingJob[0];

    console.log(
      `Job ${validatedData.jobId} being updated by user ${userId} in project ${project.name}`
    );
    if (job.createdByUserId && job.createdByUserId !== userId) {
      console.log(
        `User ${userId} is updating job ${validatedData.jobId} originally created by ${job.createdByUserId}`
      );
    }

    try {
      // Calculate next run date if cron schedule is provided
      let nextRunAt = null;
      try {
        if (validatedData.cronSchedule) {
          nextRunAt = getNextRunDate(validatedData.cronSchedule);
        }
      } catch (error) {
        console.error(`Failed to calculate next run date: ${error}`);
      }

      // Update the job basic information
      await dbInstance
        .update(jobs)
        .set({
          name: validatedData.name,
          description: validatedData.description || "",
          cronSchedule: validatedData.cronSchedule || null,
          nextRunAt: nextRunAt,
          alertConfig: validatedData.alertConfig || null,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, validatedData.jobId));

      // Update notification provider links if alert config is enabled
      if (
        validatedData.alertConfig?.enabled &&
        Array.isArray(validatedData.alertConfig.notificationProviders)
      ) {
        // First, delete existing links
        await dbInstance
          .delete(jobNotificationSettings)
          .where(eq(jobNotificationSettings.jobId, validatedData.jobId));

        // Then, create new links
        await Promise.all(
          validatedData.alertConfig.notificationProviders.map((providerId) =>
            dbInstance.insert(jobNotificationSettings).values({
              jobId: validatedData.jobId,
              notificationProviderId: providerId,
            })
          )
        );
      }

      // Delete all existing test associations
      await dbInstance
        .delete(jobTests)
        .where(eq(jobTests.jobId, validatedData.jobId));

      // Create new test associations with updated ordering
      const testRelations = validatedData.tests.map((test, index) => ({
        jobId: validatedData.jobId,
        testId: test.id,
        orderPosition: index,
      }));

      if (testRelations.length > 0) {
        await dbInstance.insert(jobTests).values(testRelations);
      }

      // Handle scheduling changes
      const previousSchedule = job.cronSchedule;
      const newSchedule = validatedData.cronSchedule;
      const previousSchedulerId = job.scheduledJobId;

      // Case 1: Previously scheduled, now removed or changed
      if (
        previousSchedule &&
        (!newSchedule || previousSchedule !== newSchedule)
      ) {
        if (previousSchedulerId) {
          try {
            await deleteScheduledJob(previousSchedulerId);
            console.log(
              `Deleted previous job scheduler: ${previousSchedulerId}`
            );
          } catch (deleteError) {
            console.error(
              `Error deleting previous scheduler ${previousSchedulerId}:`,
              deleteError
            );
            // Continue anyway - we'll still clear the scheduledJobId in the database
          }

          // If schedule is removed (not just changed), always clear scheduler ID
          if (!newSchedule || newSchedule.trim() === "") {
            await dbInstance
              .update(jobs)
              .set({ scheduledJobId: null })
              .where(eq(jobs.id, validatedData.jobId));
          }
        }
      }

      // Case 2: New schedule added or schedule changed
      let scheduledJobId = null;
      if (
        newSchedule &&
        newSchedule.trim() !== "" &&
        (!previousSchedule || previousSchedule !== newSchedule)
      ) {
        try {
          scheduledJobId = await scheduleJob({
            name: validatedData.name,
            cron: newSchedule,
            jobId: validatedData.jobId,
            retryLimit: 3,
          });

          console.log(`Created new job scheduler: ${scheduledJobId}`);

          // Update the job with the new scheduler ID
          await dbInstance
            .update(jobs)
            .set({ scheduledJobId })
            .where(eq(jobs.id, validatedData.jobId));
        } catch (scheduleError) {
          console.error(`Failed to schedule job:`, scheduleError);
          // Continue anyway - the job is updated but schedule failed
        }
      } else if (
        newSchedule &&
        newSchedule === previousSchedule &&
        previousSchedulerId
      ) {
        // Keep the existing scheduler ID if schedule hasn't changed
        scheduledJobId = previousSchedulerId;
      }

      console.log(
        `Job ${validatedData.jobId} updated successfully by user ${userId} in project ${project.name}`
      );

      // Log the audit event for job update
      await logAuditEvent({
        userId,
        action: "job_updated",
        resource: "job",
        resourceId: validatedData.jobId,
        metadata: {
          organizationId,
          jobName: validatedData.name,
          projectId: project.id,
          projectName: project.name,
          testsCount: validatedData.tests.length,
          cronScheduleChanged: previousSchedule !== newSchedule,
          oldCronSchedule: previousSchedule,
          newCronSchedule: newSchedule,
          alertsEnabled: validatedData.alertConfig?.enabled || false,
          notificationProvidersCount:
            validatedData.alertConfig?.notificationProviders?.length || 0,
        },
        success: true,
      });

      // Revalidate the jobs page
      revalidatePath("/jobs");
      revalidatePath(`/jobs/edit/${validatedData.jobId}`);

      return {
        success: true,
        message: "Job updated successfully",
        job: {
          id: validatedData.jobId,
          name: validatedData.name,
          description: validatedData.description || "",
          cronSchedule: validatedData.cronSchedule || null,
          nextRunAt: nextRunAt?.toISOString() || null,
          scheduledJobId,
          testCount: validatedData.tests.length,
        },
      };
    } catch (dbError) {
      console.error(`Database error:`, dbError);
      return {
        success: false,
        message: `Failed to update job: ${
          dbError instanceof Error ? dbError.message : String(dbError)
        }`,
        error: dbError,
      };
    }
  } catch (validationError) {
    console.error(`Validation error:`, validationError);
    return {
      success: false,
      message: "Invalid data provided",
      error: validationError,
    };
  }
}
