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

// Limits shared by POST /api/jobs and updateJob. Name matches jobs.name varchar(255); description is unbounded text in the DB.
export const jobNameSchema = z.string().trim().min(1, { message: "Job name is required." }).max(255, { message: "Job name must be at most 255 characters." });
export const jobDescriptionSchema = z.string().max(2000, { message: "Description must be at most 2000 characters." });
export const MAX_JOB_TESTS = 50;

export const JOB_CONFLICT_ERROR = "Job changed since you opened it — reload";
class JobConflictError extends Error {}

const updateJobSchema = z.object({
  jobId: z.string().uuid(),
  name: jobNameSchema,
  description: jobDescriptionSchema.optional().default(""),
  // The updatedAt the editor loaded; when set, the save only applies if the job is unchanged since.
  expectedUpdatedAt: z.string().datetime().optional(),
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
      // Omitted fields keep the stored value; create-route defaults apply only when none is stored (see updateJob).
      enabled: z.boolean().optional(),
      notificationProviders: z.array(z.string()).optional(),
      alertOnFailure: z.boolean().optional(),
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
  inherited?: { cronSchedule?: boolean; alertConfig?: boolean; description?: boolean };
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
    // An inherited (stored) description may predate the length limit; only a caller-supplied one is capped.
    const validatedData = (contextOverride?.inherited?.description
      ? updateJobSchema.extend({ description: z.string() })
      : updateJobSchema
    ).parse(data);
    const cronError = contextOverride?.inherited?.cronSchedule ? null : validateJobCron(validatedData.cronSchedule);
    if (cronError) return { success: false, message: cronError };
    const thresholdError = contextOverride?.inherited?.alertConfig ? null : alertThresholdError(validatedData.alertConfig);
    if (thresholdError) return { success: false, message: thresholdError };

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
        alertConfig: jobs.alertConfig,
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

    // Fields the request omits keep the stored value (`supercheck pull` strips fields equal to their defaults,
    // so a stored `alertOnFailure: false` must survive); the defaults below apply only when nothing is stored.
    const supplied = Object.fromEntries(Object.entries(validatedData.alertConfig ?? {}).filter(([, v]) => v != null));
    const alertConfig = validatedData.alertConfig
      ? {
          enabled: false,
          notificationProviders: [] as string[],
          alertOnFailure: true,
          failureThreshold: 1,
          recoveryThreshold: 1,
          ...(job.alertConfig ?? {}),
          ...supplied,
        } as NonNullable<typeof validatedData.alertConfig> & { enabled: boolean; notificationProviders: string[]; alertOnFailure: boolean; failureThreshold: number; recoveryThreshold: number }
      : undefined;

    // Validate alert configuration if enabled
    let validatedNotificationProviderIds: string[] = [];
    if (alertConfig?.enabled) {
      // Check if at least one notification provider is selected
      if (
        !alertConfig.notificationProviders ||
        alertConfig.notificationProviders.length === 0
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
        alertConfig.notificationProviders.length > maxJobChannels
      ) {
        return {
          success: false,
          error: `You can only select up to ${maxJobChannels} notification channels`,
        };
      }

      // Check if at least one alert type is selected
      const alertTypesSelected = [
        alertConfig.alertOnFailure,
        alertConfig.alertOnSuccess,
        alertConfig.alertOnTimeout,
      ].some(Boolean);

      if (!alertTypesSelected) {
        return {
          success: false,
          error:
            "At least one alert type must be selected when alerts are enabled",
        };
      }

    }

    if (alertConfig?.notificationProviders?.length) {
      try {
        validatedNotificationProviderIds =
          await validateNotificationProviderOwnership({
            providerIds: alertConfig.notificationProviders,
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

    const currentTestIds = currentTests.map((test) => test.id);
    const testsChanged =
      currentTestIds.length !== testIds.length ||
      currentTestIds.some((testId, index) => testIds[index] !== testId);
    // A legacy job over the cap stays editable while its selection is unchanged; the cap applies to changes.
    if (testsChanged && testIds.length > MAX_JOB_TESTS) {
      const message = `A job can have at most ${MAX_JOB_TESTS} tests.`;
      return { success: false, message, error: message };
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
        const updated = await dbInstance
          .update(jobs)
          .set({
            name: validatedData.name,
            description: validatedData.description || "",
            cronSchedule: validatedData.cronSchedule || null,
            nextRunAt: nextRunAt,
            alertConfig: alertConfig
              ? {
                  ...alertConfig,
                  // A null threshold (stored by an older write, or sent now) falls back to 1, as create does.
                  failureThreshold: alertConfig.failureThreshold ?? 1,
                  recoveryThreshold: alertConfig.recoveryThreshold ?? 1,
                  notificationProviders: validatedNotificationProviderIds,
                }
              : null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(jobs.id, validatedData.jobId),
              validatedData.expectedUpdatedAt ? eq(jobs.updatedAt, new Date(validatedData.expectedUpdatedAt)) : undefined,
            ),
          )
          .returning({ id: jobs.id });
        // Throwing rolls the transaction back, so a stale editor changes nothing.
        if (updated.length === 0) throw new JobConflictError(JOB_CONFLICT_ERROR);

        // Update notification provider links if alert config is enabled
        if (
          alertConfig?.enabled &&
          Array.isArray(alertConfig.notificationProviders)
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
          alertsEnabled: alertConfig?.enabled || false,
          notificationProvidersCount:
            alertConfig?.notificationProviders?.length || 0,
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
      if (dbError instanceof JobConflictError) return { success: false, message: JOB_CONFLICT_ERROR, error: JOB_CONFLICT_ERROR };
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
    // A ZodError becomes a readable message so callers answer 400, not 500.
    const message = validationError instanceof z.ZodError ? validationError.issues[0]?.message ?? "Invalid data provided" : "Invalid data provided";
    return {
      success: false,
      message,
      error: validationError instanceof z.ZodError ? message : validationError,
    };
  }
}
