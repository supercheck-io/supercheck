import "server-only";

import { db } from "@/utils/db";
import {
  jobs,
  jobTests,
  jobNotificationSettings,
  tests as testsTable,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { alertThresholdError } from "@/lib/alert-thresholds";
import { validateJobCron } from "@/lib/job-cron-validation";
import { scheduleJob, deleteScheduledJob } from "@/lib/job-scheduler";
import { getNextRunDate } from "@/lib/cron-utils";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { validateNotificationProviderOwnership } from "@/lib/notification-providers/ownership";
import { subscriptionService, SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";
import type { TestType } from "@/db/schema/types";
import {
  getJobTestTypeMismatchError,
  isTestTypeCompatibleWithJobType,
} from "@/lib/script-type-validator";

const updateJobSchema = z.object({
  jobId: z.string().uuid(),
  name: z.string(),
  description: z.string().optional().default(""),
  cronSchedule: z.string().optional(),
  tests: z
    .array(
      z.object({
        id: z.string().uuid(),
      })
    )
    .min(1, { message: "At least one test is required." })
    .optional(),
  alertConfig: z
    .object({
      enabled: z.boolean(),
      notificationProviders: z.array(z.string()),
      alertOnFailure: z.boolean(),
      alertOnSuccess: z.boolean().optional(),
      alertOnTimeout: z.boolean().optional(),
      failureThreshold: z.number().nullish(),
      recoveryThreshold: z.number().nullish(),
      customMessage: z.string().optional(),
      incidentEnabled: z.boolean().optional(),
      incidentSeverity: z.enum(["sev1", "sev2", "sev3", "sev4"]).optional(),
      autoResolveIncident: z.boolean().optional(),
    })
    .optional(),
});

export type UpdateJobData = z.infer<typeof updateJobSchema>;

type UpdateJobContext = {
  userId: string;
  organizationId: string;
  project: { id: string; name: string; userRole: string };
  /** Fields the caller filled from the stored job. Stored values accepted earlier are not re-validated, so an unrelated edit still works. */
  inherited?: { cronSchedule?: boolean; alertConfig?: boolean };
};

export async function updateJob(data: UpdateJobData, contextOverride?: UpdateJobContext) {
  console.log(`Updating job ${data.jobId}`);

  try {
    // Get current project context (includes auth verification)
    const { userId, project, organizationId } = contextOverride ?? await requireProjectContext();

    // Check EDIT_JOBS permission (optimized - reuses context from requireProjectContext)
    const canEditJobs = checkPermissionWithContext("job", "update", {
      userId,
      organizationId,
      project,
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
    const cronError = contextOverride?.inherited?.cronSchedule ? null : validateJobCron(validatedData.cronSchedule);
    if (cronError) return { success: false, message: cronError };
    const thresholdError = contextOverride?.inherited?.alertConfig ? null : alertThresholdError(validatedData.alertConfig);
    if (thresholdError) return { success: false, message: thresholdError };

    // Validate alert configuration if enabled
    let validatedNotificationProviderIds: string[] = [];
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
        process.env.MAX_JOB_NOTIFICATION_CHANNELS || "10",
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

    if (validatedData.alertConfig?.notificationProviders?.length) {
      try {
        validatedNotificationProviderIds =
          await validateNotificationProviderOwnership({
            providerIds: validatedData.alertConfig.notificationProviders,
            organizationId,
            projectId: project.id,
          });
      } catch (providerValidationError) {
        return {
          success: false,
          message:
            providerValidationError instanceof Error
              ? providerValidationError.message
              : "Invalid or unauthorized notification provider IDs",
        };
      }
    }

    // Edits can (re)schedule billable runs, so they need the same access as createJob.
    try {
      await subscriptionService.blockUntilSubscribed(organizationId);
      await subscriptionService.requireValidPolarCustomer(organizationId);
    } catch (accessError) {
      if (accessError instanceof SubscriptionAccessDeniedError) {
        return { success: false, message: accessError.message, error: accessError.message };
      }
      throw accessError;
    }

    const dbInstance = db;

    // Check if the job exists and user has access to it (project scoped)
    const existingJob = await dbInstance
      .select({
        id: jobs.id,
        name: jobs.name,
        createdByUserId: jobs.createdByUserId,
        jobType: jobs.jobType,
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

    const currentTests = await dbInstance
      .select({ id: jobTests.testId })
      .from(jobTests)
      .where(eq(jobTests.jobId, validatedData.jobId))
      .orderBy(asc(jobTests.orderPosition));

    let testsToUse = validatedData.tests;
    if (!testsToUse) {
      testsToUse = currentTests.map((test) => ({ id: test.id }));
    }

    if (!testsToUse || testsToUse.length === 0) {
      return {
        success: false,
        message: "At least one test is required for a job.",
      };
    }

    const testIds = testsToUse.map((test) => test.id);
    if (new Set(testIds).size !== testIds.length) {
      return {
        success: false,
        message: "Duplicate test IDs are not allowed in a job.",
      };
    }

    const scopedTests = await dbInstance
      .select({ id: testsTable.id, type: testsTable.type })
      .from(testsTable)
      .where(
        and(
          inArray(testsTable.id, testIds),
          eq(testsTable.projectId, project.id),
          eq(testsTable.organizationId, organizationId)
        )
      );

    if (scopedTests.length !== testIds.length) {
      return {
        success: false,
        message: "One or more selected tests are invalid or not accessible",
      };
    }

    const jobType: "k6" | "playwright" =
      job.jobType === "k6" ? "k6" : "playwright";

    for (const scopedTest of scopedTests) {
      if (
        !isTestTypeCompatibleWithJobType(
          scopedTest.type as TestType,
          jobType
        )
      ) {
        return {
          success: false,
          message: getJobTestTypeMismatchError(
            scopedTest.id,
            scopedTest.type as TestType,
            jobType
          ),
        };
      }
    }

    // Only when the caller supplies tests: a legacy multi-test k6 job must stay editable otherwise.
    if (jobType === "k6" && validatedData.tests && testIds.length > 1) {
      return { success: false, message: "A k6 job runs exactly one performance test." };
    }

    const currentTestIds = currentTests.map((test) => test.id);
    const testsChanged =
      currentTestIds.length !== testIds.length ||
      currentTestIds.some((testId, index) => testIds[index] !== testId);

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
      let nextRunAt: Date | null = null;
      try {
        if (validatedData.cronSchedule) {
          nextRunAt = getNextRunDate(validatedData.cronSchedule);
        }
      } catch (error) {
        console.error(`Failed to calculate next run date: ${error}`);
      }

      // The job row, notification links and tests change together or not at all; BullMQ scheduling follows the commit.
      await db.transaction(async (dbInstance) => {
        // Update the job basic information
        await dbInstance
          .update(jobs)
          .set({
            name: validatedData.name,
            description: validatedData.description || "",
            cronSchedule: validatedData.cronSchedule || null,
            nextRunAt: nextRunAt,
            alertConfig: validatedData.alertConfig
              ? {
                  ...validatedData.alertConfig,
                  // A null threshold (stored by an older write, or sent now) falls back to 1, as create does.
                  failureThreshold: validatedData.alertConfig.failureThreshold ?? 1,
                  recoveryThreshold: validatedData.alertConfig.recoveryThreshold ?? 1,
                  notificationProviders: validatedNotificationProviderIds,
                }
              : null,
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, validatedData.jobId));

        // Update notification provider links if alert config is enabled
        if (
          validatedData.alertConfig?.enabled &&
          Array.isArray(validatedData.alertConfig.notificationProviders)
        ) {
          const currentProviderLinks = await dbInstance
            .select({ id: jobNotificationSettings.notificationProviderId })
            .from(jobNotificationSettings)
            .where(eq(jobNotificationSettings.jobId, validatedData.jobId));

          const currentProviderIds = currentProviderLinks
            .map((provider) => provider.id)
            .sort();
          const nextProviderIds = [...validatedNotificationProviderIds].sort();

          const providersChanged =
            currentProviderIds.length !== nextProviderIds.length ||
            currentProviderIds.some((providerId, index) => nextProviderIds[index] !== providerId);

          if (providersChanged) {
            await dbInstance
              .delete(jobNotificationSettings)
              .where(eq(jobNotificationSettings.jobId, validatedData.jobId));

            if (validatedNotificationProviderIds.length > 0) {
              await dbInstance
                .insert(jobNotificationSettings)
                .values(
                  validatedNotificationProviderIds.map((providerId) => ({
                    jobId: validatedData.jobId,
                    notificationProviderId: providerId,
                  }))
                )
                .onConflictDoNothing();
            }
          }
        }

        if (testsChanged) {
          await dbInstance
            .delete(jobTests)
            .where(eq(jobTests.jobId, validatedData.jobId));

          const testRelations = testsToUse.map((test, index) => ({
            jobId: validatedData.jobId,
            testId: test.id,
            orderPosition: index,
          }));

          if (testRelations.length > 0) {
            await dbInstance.insert(jobTests).values(testRelations);
          }
        }
      });

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
      let scheduleWarning: string | undefined;
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
          // The job is saved, but nothing will run it: say so and drop the next run time it cannot honour.
          scheduleWarning = "Job saved, but its schedule could not be registered. Save it again to retry.";
          nextRunAt = null;
          await dbInstance.update(jobs).set({ nextRunAt: null }).where(eq(jobs.id, validatedData.jobId));
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
          testsCount: testsToUse.length,
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
          testCount: testsToUse.length,
          ...(scheduleWarning ? { warning: scheduleWarning } : {}),
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
