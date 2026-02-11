import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import {
  jobs,
  jobTests,
  tests as testsTable,
  testTags,
  tags,
  runs,
  JobStatus,
  jobNotificationSettings,
  JobType,
} from "@/db/schema";
import { desc, eq, inArray, and, asc } from "drizzle-orm";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { subscriptionService } from "@/lib/services/subscription-service";
import { getNextRunDate } from "@/lib/cron-utils";
import { scheduleJob } from "@/lib/job-scheduler";

import { randomUUID } from "crypto";


interface Test {
  id: string;
  name?: string;
  title?: string;
  script?: string;
}

interface JobData {
  id?: string;
  name: string;
  description: string;
  cronSchedule: string;
  status?: JobStatus;
  timeoutSeconds: number;
  retryCount: number;
  config: Record<string, unknown>;
  tests: Test[];
  jobType?: JobType;
  alertConfig?: {
    enabled: boolean;
    notificationProviders: string[];
    alertOnFailure: boolean;
    alertOnSuccess: boolean;
    alertOnTimeout: boolean;
    failureThreshold: number;
    recoveryThreshold: number;
    customMessage: string;
  };
  organizationId?: string;
  projectId?: string;
  createdByUserId?: string;
}


// GET all jobs - OPTIMIZED: Uses batch queries instead of N+1 pattern
// SECURITY: Added default pagination to prevent fetching unlimited records
export async function GET(request: Request) {
  try {
    const context = await requireAuthContext();

    // Use current project context
    const targetProjectId = context.project.id;

    // PERFORMANCE: Use checkPermissionWithContext to avoid duplicate DB queries
    const canView = checkPermissionWithContext("job", "view", context);

    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // OPTIMIZED: Parse pagination params with sensible defaults
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "100", 10)));
    const offset = (page - 1) * limit;

    // Query 1: Get jobs for this project with pagination
    const jobsResult = await db
      .select({
        id: jobs.id,
        name: jobs.name,
        description: jobs.description,
        cronSchedule: jobs.cronSchedule,
        status: jobs.status,
        alertConfig: jobs.alertConfig,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        organizationId: jobs.organizationId,
        projectId: jobs.projectId,
        createdByUserId: jobs.createdByUserId,
        lastRunAt: jobs.lastRunAt,
        nextRunAt: jobs.nextRunAt,
        jobType: jobs.jobType,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.projectId, targetProjectId),
          eq(jobs.organizationId, context.organizationId)
        )
      )
      .orderBy(desc(jobs.createdAt)) // Sort by latest created first
      .limit(limit)
      .offset(offset);

    if (jobsResult.length === 0) {
      return NextResponse.json({ success: true, jobs: [] });
    }

    const jobIds = jobsResult.map((job) => job.id);

    // PERFORMANCE: Run independent queries in parallel
    // Query 2 (tests) and Query 4 (last runs) both depend only on jobIds
    const [allJobTests, allLastRuns] = await Promise.all([
      // Query 2: Batch fetch all tests for all jobs in one query
      db
        .select({
          jobId: jobTests.jobId,
          testId: testsTable.id,
          title: testsTable.title,
          description: testsTable.description,
          type: testsTable.type,
          priority: testsTable.priority,
          script: testsTable.script,
          createdAt: testsTable.createdAt,
          updatedAt: testsTable.updatedAt,
          orderPosition: jobTests.orderPosition,
        })
        .from(jobTests)
        .innerJoin(testsTable, eq(testsTable.id, jobTests.testId))
        .where(inArray(jobTests.jobId, jobIds))
        .orderBy(asc(jobTests.orderPosition)),

      // Query 4: Batch fetch last run for all jobs
      // This gets the most recent run for each job in a single query
      db
        .select({
          jobId: runs.jobId,
          id: runs.id,
          status: runs.status,
          startedAt: runs.startedAt,
          completedAt: runs.completedAt,
          durationMs: runs.durationMs,
          errorDetails: runs.errorDetails,
        })
        .from(runs)
        .where(inArray(runs.jobId, jobIds))
        .orderBy(runs.jobId, desc(runs.startedAt)),
    ]);

    // Query 3: Batch fetch all tags for all tests (depends on Query 2 results)
    const allTestIds = [...new Set(allJobTests.map((t) => t.testId))];
    const allTestTags =
      allTestIds.length > 0
        ? await db
            .select({
              testId: testTags.testId,
              tagId: tags.id,
              tagName: tags.name,
              tagColor: tags.color,
            })
            .from(testTags)
            .innerJoin(tags, eq(testTags.tagId, tags.id))
            .where(inArray(testTags.testId, allTestIds))
        : [];

    // Build lookup maps for O(1) access
    // Map: jobId -> tests[]
    const jobTestsMap = new Map<string, typeof allJobTests>();
    allJobTests.forEach((test) => {
      if (!jobTestsMap.has(test.jobId)) {
        jobTestsMap.set(test.jobId, []);
      }
      jobTestsMap.get(test.jobId)!.push(test);
    });

    // Map: testId -> tags[]
    const testTagsMap = new Map<
      string,
      Array<{ id: string; name: string; color: string | null }>
    >();
    allTestTags.forEach(({ testId, tagId, tagName, tagColor }) => {
      if (!testTagsMap.has(testId)) {
        testTagsMap.set(testId, []);
      }
      testTagsMap.get(testId)!.push({
        id: tagId,
        name: tagName,
        color: tagColor,
      });
    });

    // Map: jobId -> lastRun (only keep the first/most recent run per job)
    const lastRunMap = new Map<string, (typeof allLastRuns)[0]>();
    allLastRuns.forEach((run) => {
      if (run.jobId && !lastRunMap.has(run.jobId)) {
        lastRunMap.set(run.jobId, run);
      }
    });

    // Assemble the final result using the lookup maps
    const jobsWithTests = jobsResult.map((job) => {
      const testsForJob = jobTestsMap.get(job.id) || [];
      const lastRun = lastRunMap.get(job.id) || null;

      return {
        ...job,
        lastRunAt: job.lastRunAt ? job.lastRunAt.toISOString() : null,
        nextRunAt: job.nextRunAt ? job.nextRunAt.toISOString() : null,
        tests: testsForJob.map((test) => ({
          id: test.testId,
          title: test.title,
          description: test.description,
          type: test.type,
          priority: test.priority,
          script: test.script,
          name: test.title || "",
          tags: testTagsMap.get(test.testId) || [],
          createdAt: test.createdAt ? test.createdAt.toISOString() : null,
          updatedAt: test.updatedAt ? test.updatedAt.toISOString() : null,
        })),
        lastRun: lastRun
          ? {
              id: lastRun.id,
              status: lastRun.status,
              errorDetails: lastRun.errorDetails,
              durationMs: lastRun.durationMs,
              startedAt: lastRun.startedAt
                ? lastRun.startedAt.toISOString()
                : null,
              completedAt: lastRun.completedAt
                ? lastRun.completedAt.toISOString()
                : null,
            }
          : null,
        createdAt: job.createdAt ? job.createdAt.toISOString() : null,
        updatedAt: job.updatedAt ? job.updatedAt.toISOString() : null,
      };
    });

    // Return standardized response format for React Query hooks
    return NextResponse.json({
      data: jobsWithTests,
      pagination: {
        total: jobsWithTests.length,
        page: 1,
        limit: jobsWithTests.length,
        totalPages: 1,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Failed to fetch jobs:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}

// POST to create a new job
export async function POST(request: NextRequest) {
  try {


    // Regular job creation - use project context
    const context = await requireAuthContext();
    const { userId, project, organizationId } = context;
    const jobData: JobData = await request.json();

    // Validate required fields
    if (!jobData.name) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required field: name is required.",
        },
        { status: 400 }
      );
    }

    if (!Array.isArray(jobData.tests) || jobData.tests.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "At least one test is required to create a job.",
        },
        { status: 400 }
      );
    }

    const invalidTest = jobData.tests.find((test) => !test?.id || typeof test.id !== "string");
    if (invalidTest) {
      return NextResponse.json(
        {
          success: false,
          error: "Each job test must include a valid test ID.",
        },
        { status: 400 }
      );
    }

    // Use current project context
    const targetProjectId = project.id;

    // SECURITY: Validate subscription before allowing job creation
    try {
      await subscriptionService.blockUntilSubscribed(organizationId);
      await subscriptionService.requireValidPolarCustomer(organizationId);
    } catch (subscriptionError) {
      console.error("Subscription validation failed:", subscriptionError);
      const errorMessage = subscriptionError instanceof Error 
        ? subscriptionError.message 
        : "Subscription validation failed";
      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 402 } // Payment Required
      );
    }

    // Check permission to create jobs
    const canCreate = checkPermissionWithContext("job", "create", context);

    if (!canCreate) {
      return NextResponse.json(
        { error: "Insufficient permissions to create jobs" },
        { status: 403 }
      );
    }

    // Generate a unique ID for the job
    const jobId = randomUUID();

    // Calculate next run date if cron schedule is provided
    let nextRunAt: Date | null = null;
    if (jobData.cronSchedule && jobData.cronSchedule.trim() !== "") {
      try {
        nextRunAt = getNextRunDate(jobData.cronSchedule);
      } catch (error) {
        console.error('Failed to calculate next run date for cron "%s":', jobData.cronSchedule, error);
        // Continue without nextRunAt - the schedule can still be set up
      }
    }

    // Insert the job into the database with default values for nullable fields
    const [insertedJob] = await db
      .insert(jobs)
      .values({
        id: jobId,
        name: jobData.name,
        description: jobData.description || null,
        cronSchedule: jobData.cronSchedule || null,
        nextRunAt: nextRunAt,
        status: jobData.status || "pending",
        alertConfig: jobData.alertConfig
          ? {
              enabled: Boolean(jobData.alertConfig.enabled),
              notificationProviders: Array.isArray(
                jobData.alertConfig.notificationProviders
              )
                ? jobData.alertConfig.notificationProviders
                : [],
              alertOnFailure:
                jobData.alertConfig.alertOnFailure !== undefined
                  ? Boolean(jobData.alertConfig.alertOnFailure)
                  : true,
              alertOnSuccess: Boolean(jobData.alertConfig.alertOnSuccess),
              alertOnTimeout: Boolean(jobData.alertConfig.alertOnTimeout),
              failureThreshold:
                typeof jobData.alertConfig.failureThreshold === "number"
                  ? jobData.alertConfig.failureThreshold
                  : 1,
              recoveryThreshold:
                typeof jobData.alertConfig.recoveryThreshold === "number"
                  ? jobData.alertConfig.recoveryThreshold
                  : 1,
              customMessage:
                typeof jobData.alertConfig.customMessage === "string"
                  ? jobData.alertConfig.customMessage
                  : "",
            }
          : null,
        organizationId: organizationId,
        projectId: targetProjectId,
        createdByUserId: userId, // Use authenticated user ID
        jobType: jobData.jobType === "k6" ? "k6" : "playwright",
      })
      .returning();

    // Validate alert configuration if enabled
    if (jobData.alertConfig?.enabled) {
      // Check if at least one notification provider is selected
      if (
        !jobData.alertConfig.notificationProviders ||
        jobData.alertConfig.notificationProviders.length === 0
      ) {
        return NextResponse.json(
          {
            error:
              "At least one notification channel must be selected when alerts are enabled",
          },
          { status: 400 }
        );
      }

      // Check notification channel limit
      const maxJobChannels = parseInt(
        process.env.MAX_JOB_NOTIFICATION_CHANNELS || "10",
        10
      );
      if (jobData.alertConfig.notificationProviders.length > maxJobChannels) {
        return NextResponse.json(
          {
            error: `You can only select up to ${maxJobChannels} notification channels`,
          },
          { status: 400 }
        );
      }

      // Check if at least one alert type is selected
      const alertTypesSelected = [
        jobData.alertConfig.alertOnFailure,
        jobData.alertConfig.alertOnSuccess,
        jobData.alertConfig.alertOnTimeout,
      ].some(Boolean);

      if (!alertTypesSelected) {
        return NextResponse.json(
          {
            error:
              "At least one alert type must be selected when alerts are enabled",
          },
          { status: 400 }
        );
      }
    }

    // Link notification providers if alert config is enabled
    if (
      insertedJob &&
      jobData.alertConfig?.enabled &&
      Array.isArray(jobData.alertConfig.notificationProviders)
    ) {
      await Promise.all(
        jobData.alertConfig.notificationProviders.map((providerId) =>
          db.insert(jobNotificationSettings).values({
            jobId: insertedJob.id,
            notificationProviderId: providerId,
          })
        )
      );
    }

    // If tests are provided, create job-test associations with order preserved
    if (jobData.tests && jobData.tests.length > 0) {
      const jobTestValues = jobData.tests.map((test, index) => ({
        jobId: jobId,
        testId: test.id,
        orderPosition: index,
      }));

      await db.insert(jobTests).values(jobTestValues);
    }

    // If a cronSchedule is provided, set up the job scheduler
    let scheduledJobId = null;
    if (jobData.cronSchedule && jobData.cronSchedule.trim() !== "") {
      try {
        scheduledJobId = await scheduleJob({
          name: jobData.name,
          cron: jobData.cronSchedule,
          jobId,
          retryLimit: 3,
        });

        // Update the job with the scheduler ID
        if (scheduledJobId) {
          await db
            .update(jobs)
            .set({ scheduledJobId })
            .where(eq(jobs.id, jobId));
        }

        console.log(`Job ${jobId} scheduled with scheduler ID ${scheduledJobId}`);
      } catch (scheduleError) {
        console.error("Failed to schedule job:", scheduleError);
        // Continue anyway - the job exists but without background scheduling
        // Manual execution will still work
      }
    }

    return NextResponse.json({
      success: true,
      job: {
        id: jobId,
        name: jobData.name,
        description: jobData.description || "",
        cronSchedule: jobData.cronSchedule,
        nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
        scheduledJobId,
        jobType: jobData.jobType === "k6" ? "k6" : "playwright",
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error creating job:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create job" },
      { status: 500 }
    );
  }
}

// PUT to update an existing job
export async function PUT(request: Request) {
  try {
    const jobData: JobData = await request.json();

    if (!jobData.id) {
      return NextResponse.json(
        { success: false, error: "Job ID is required" },
        { status: 400 }
      );
    }

    // Get current project context (includes auth verification)
    const context = await requireAuthContext();
    const { project, organizationId } = context;

    // Validate required fields
    if (!jobData.name || !jobData.cronSchedule || !jobData.description) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing required fields. Name, description, and cron schedule are required.",
        },
        { status: 400 }
      );
    }

    if (!Array.isArray(jobData.tests) || jobData.tests.length === 0) {
      return NextResponse.json(
        { success: false, error: "At least one test is required to update a job." },
        { status: 400 }
      );
    }

    const invalidTest = jobData.tests.find((test) => !test?.id || typeof test.id !== "string");
    if (invalidTest) {
      return NextResponse.json(
        { success: false, error: "Each job test must include a valid test ID." },
        { status: 400 }
      );
    }

    // Check if job exists and belongs to current project
    const existingJob = await db
      .select({
        id: jobs.id,
        projectId: jobs.projectId,
        organizationId: jobs.organizationId,
      })
      .from(jobs)
      .where(eq(jobs.id, jobData.id))
      .limit(1);

    if (existingJob.length === 0) {
      return NextResponse.json(
        { success: false, error: "Job not found" },
        { status: 404 }
      );
    }

    // Verify job belongs to current project and organization
    if (
      existingJob[0].projectId !== project.id ||
      existingJob[0].organizationId !== organizationId
    ) {
      return NextResponse.json(
        { success: false, error: "Job not found or access denied" },
        { status: 404 }
      );
    }

    // Check permission to update jobs
    const canEdit = checkPermissionWithContext("job", "update", context);

    if (!canEdit) {
      return NextResponse.json(
        { error: "Insufficient permissions to edit jobs" },
        { status: 403 }
      );
    }

    // Update the job in the database
    await db
      .update(jobs)
      .set({
        name: jobData.name,
        description: jobData.description || "",
        cronSchedule: jobData.cronSchedule,
        status: jobData.status as JobStatus,
        alertConfig: jobData.alertConfig || null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobData.id));

    // Delete existing job-test associations
    await db.delete(jobTests).where(eq(jobTests.jobId, jobData.id));

    // If tests are provided, create new job-test associations
    if (jobData.tests && jobData.tests.length > 0) {
      const jobTestValues = jobData.tests.map((test) => ({
        jobId: jobData.id!,
        testId: test.id,
      }));

      await db.insert(jobTests).values(jobTestValues);
    }

    return NextResponse.json({
      success: true,
      job: {
        id: jobData.id,
        name: jobData.name,
        description: jobData.description || "",
        cronSchedule: jobData.cronSchedule,
      },
    });
  } catch (error) {
    console.error("Error updating job:", error);

    // Handle authentication/authorization errors
    if (isAuthError(error)) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }

    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json(
        { success: false, error: "Resource not found or access denied" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Failed to update job" },
      { status: 500 }
    );
  }
}


