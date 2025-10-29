"use server";

import { db } from "@/utils/db";
import { jobs, jobTests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { scheduleJob } from "@/lib/job-scheduler";
import crypto from "crypto";
import { getNextRunDate } from "@/lib/cron-utils";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";

const createJobSchema = z.object({
  name: z.string(),
  description: z.string().optional().default(""),
  cronSchedule: z.string().optional(),
  tests: z.array(
    z.object({
      id: z.string().uuid(),
    })
  ),
});

export type CreateJobData = z.infer<typeof createJobSchema>;

export async function createJob(data: CreateJobData) {
  console.log(`Creating job with data:`, JSON.stringify(data, null, 2));

  try {
    // Get current project context (includes auth verification)
    const { userId, project, organizationId } = await requireProjectContext();

    // Check job creation permission using Better Auth
    try {
      await requirePermissions({
        job: ["create"],
      });
    } catch (error) {
      console.warn(
        `User ${userId} attempted to create job without permission:`,
        error
      );
      return {
        success: false,
        message: "Insufficient permissions to create jobs",
      };
    }

    // Validate the data
    const validatedData = createJobSchema.parse(data);

    // Generate a UUID for the job
    const jobId = crypto.randomUUID();

    // Calculate next run date if cron schedule is provided
    let nextRunAt = null;
    try {
      if (validatedData.cronSchedule) {
        nextRunAt = getNextRunDate(validatedData.cronSchedule);
      }
    } catch (error) {
      console.error(`Failed to calculate next run date: ${error}`);
    }

    try {
      // Create the job with proper project and user association
      await db.insert(jobs).values({
        id: jobId,
        organizationId: organizationId,
        projectId: project.id,
        name: validatedData.name,
        description: validatedData.description || "",
        cronSchedule: validatedData.cronSchedule || null,
        status: "pending",
        nextRunAt: nextRunAt,
        createdByUserId: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Create job-test relationships, tracking the order of the tests
      const testRelations = validatedData.tests.map((test, index) => ({
        jobId,
        testId: test.id,
        orderPosition: index,
      }));

      if (testRelations.length > 0) {
        await db.insert(jobTests).values(testRelations);
      }

      // If a cronSchedule is provided, set up the schedule
      let scheduledJobId = null;
      if (
        validatedData.cronSchedule &&
        validatedData.cronSchedule.trim() !== ""
      ) {
        try {
          scheduledJobId = await scheduleJob({
            name: validatedData.name,
            cron: validatedData.cronSchedule,
            jobId,
            retryLimit: 3,
          });

          // Update the job with the scheduler ID
          await db
            .update(jobs)
            .set({ scheduledJobId })
            .where(eq(jobs.id, jobId));

          console.log(`Job ${jobId} scheduled with ID ${scheduledJobId}`);
        } catch (scheduleError) {
          console.error("Failed to schedule job:", scheduleError);
          // Continue anyway - the job exists but without scheduling
        }
      }

      console.log(
        `Job ${jobId} created successfully by user ${userId} in project ${project.name}`
      );

      // Log the audit event
      await logAuditEvent({
        userId,
        action: "job_created",
        resource: "job",
        resourceId: jobId,
        metadata: {
          organizationId,
          jobName: validatedData.name,
          projectId: project.id,
          projectName: project.name,
          testsCount: validatedData.tests.length,
          hasCronSchedule: !!validatedData.cronSchedule,
          cronSchedule: validatedData.cronSchedule,
        },
        success: true,
      });

      // Revalidate the jobs page
      revalidatePath("/jobs");

      return {
        success: true,
        message: "Job created successfully",
        job: {
          id: jobId,
          name: validatedData.name,
          description: validatedData.description || "",
          cronSchedule: validatedData.cronSchedule || null,
          nextRunAt: nextRunAt?.toISOString() || null,
          scheduledJobId,
          testCount: validatedData.tests.length,
          createdByUserId: userId,
        },
      };
    } catch (dbError) {
      console.error("Database error:", dbError);
      return {
        success: false,
        message: `Failed to create job: ${
          dbError instanceof Error ? dbError.message : String(dbError)
        }`,
        error: dbError,
      };
    }
  } catch (validationError) {
    console.error("Validation error:", validationError);
    return {
      success: false,
      message: "Invalid data provided",
      error: validationError,
    };
  }
}
