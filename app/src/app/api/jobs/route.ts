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
  TestRunStatus,
  jobNotificationSettings,
  JobTrigger,
  JobType,
} from "@/db/schema";
import { desc, eq, inArray, and } from "drizzle-orm";
import { hasPermission } from '@/lib/rbac/middleware';
import { requireProjectContext } from '@/lib/project-context';

import { randomUUID } from "crypto";



// Create a simple implementation here
async function executeJob(jobId: string, tests: { id: string; script: string }[]) {
  // This function is now simplified to just create a run record
  // The actual execution is handled by the backend service
  
  console.log(`Received job execution request: { jobId: ${jobId}, testCount: ${tests.length} }`);
  
  const runId = randomUUID();
  
  // Get job details to add project scoping to run
  const jobDetails = await db
    .select({ projectId: jobs.projectId })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  
  // Create a run record
  await db.insert(runs).values({
    id: runId,
    jobId: jobId,
    projectId: jobDetails.length > 0 ? jobDetails[0].projectId : null,
    status: 'running' as TestRunStatus,
    startedAt: new Date(),
    trigger: 'manual' as JobTrigger,
  });
  
  console.log(`[${jobId}] Created running test run record: ${runId}`);
  
  return {
    runId,
    jobId,
    status: 'running',
    message: 'Job execution request queued',
    // Properties needed for other parts of the code
    success: true,
    results: [],
    reportUrl: null
  };
}

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

// Define the TestResult interface to match what's returned by executeMultipleTests
interface TestResult {
  testId: string;
  success: boolean;
  error: string | null;
  stdout?: string;
  stderr?: string;
}

// GET all jobs
export async function GET() {
  try {
    const { project, organizationId } = await requireProjectContext();
    
    // Use current project context
    const targetProjectId = project.id;
    
    // Build permission context and check access
    // Check permission to view jobs
    const canView = await hasPermission('job', 'view', { organizationId, projectId: targetProjectId });
    
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Get all jobs with their associated tests and last run status (scoped to project)
    const result = await db
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
      .where(and(
        eq(jobs.projectId, targetProjectId),
        eq(jobs.organizationId, organizationId)
      ))
      .orderBy(desc(jobs.id)); // UUIDv7 is time-ordered (PostgreSQL 18+)

    // For each job, get its associated tests
    const jobsWithTests = await Promise.all(
      result.map(async (job) => {
        const jobTestsResult = await db
          .select({
            id: testsTable.id,
            title: testsTable.title,
            description: testsTable.description,
            type: testsTable.type,
            priority: testsTable.priority,
            script: testsTable.script,
            createdAt: testsTable.createdAt,
            updatedAt: testsTable.updatedAt,
          })
          .from(testsTable)
          .innerJoin(jobTests, eq(testsTable.id, jobTests.testId))
          .where(eq(jobTests.jobId, job.id));

        // Get tags for all tests in this job
        const testIds = jobTestsResult.map(test => test.id);
        const testTagsForJob = testIds.length > 0 ? await db
          .select({
            testId: testTags.testId,
            tagId: tags.id,
            tagName: tags.name,
            tagColor: tags.color,
          })
          .from(testTags)
          .innerJoin(tags, eq(testTags.tagId, tags.id))
          .where(inArray(testTags.testId, testIds)) : [];

        // Group tags by test ID
        const testTagsMap = new Map<string, Array<{ id: string; name: string; color: string | null }>>();
        testTagsForJob.forEach(({ testId, tagId, tagName, tagColor }) => {
          if (!testTagsMap.has(testId)) {
            testTagsMap.set(testId, []);
          }
          testTagsMap.get(testId)!.push({
            id: tagId,
            name: tagName,
            color: tagColor,
          });
        });

        // Get the last run for this job
        const lastRunResult = await db
          .select({
            id: runs.id,
            status: runs.status,
            startedAt: runs.startedAt,
            completedAt: runs.completedAt,
            duration: runs.duration,
          })
          .from(runs)
          .where(eq(runs.jobId, job.id))
          .orderBy(desc(runs.startedAt))
          .limit(1);

        const lastRun = lastRunResult[0] || null;

        return {
          ...job,
          lastRunAt: job.lastRunAt ? job.lastRunAt.toISOString() : null,
          nextRunAt: job.nextRunAt ? job.nextRunAt.toISOString() : null,
          tests: jobTestsResult.map((test) => ({
            ...test,
            name: test.title || "",
            script: test.script,
            tags: testTagsMap.get(test.id) || [],
            createdAt: test.createdAt ? test.createdAt.toISOString() : null,
            updatedAt: test.updatedAt ? test.updatedAt.toISOString() : null,
          })),
          lastRun: lastRun ? {
            ...lastRun,
            startedAt: lastRun.startedAt ? lastRun.startedAt.toISOString() : null,
            completedAt: lastRun.completedAt ? lastRun.completedAt.toISOString() : null,
          } : null,
          createdAt: job.createdAt ? job.createdAt.toISOString() : null,
          updatedAt: job.updatedAt ? job.updatedAt.toISOString() : null,
        };
      })
    );

    return NextResponse.json({
      success: true,
      jobs: jobsWithTests,
    });
  } catch (error) {
    console.error('Failed to fetch jobs:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}

// POST to create a new job
export async function POST(request: NextRequest) {
  try {
    // Check if this is a job execution request first
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    if (action === "run") {
      return await runJob(request);
    }

    // Regular job creation - use project context
    const { userId, project, organizationId } = await requireProjectContext();
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
    
    // Use current project context
    const targetProjectId = project.id;
    
    // Build permission context and check access
    // Check permission to create jobs
    const canCreate = await hasPermission('job', 'create', { organizationId, projectId: targetProjectId });
    
    if (!canCreate) {
      return NextResponse.json(
        { error: 'Insufficient permissions to create jobs' },
        { status: 403 }
      );
    }

    // Generate a unique ID for the job
    const jobId = randomUUID();

    // Insert the job into the database with default values for nullable fields
    const [insertedJob] = await db.insert(jobs).values({
      id: jobId,
      name: jobData.name,
      description: jobData.description || null,
      cronSchedule: jobData.cronSchedule || null,
      status: jobData.status || 'pending',
      alertConfig: jobData.alertConfig ? {
        enabled: Boolean(jobData.alertConfig.enabled),
        notificationProviders: Array.isArray(jobData.alertConfig.notificationProviders) ? jobData.alertConfig.notificationProviders : [],
        alertOnFailure: jobData.alertConfig.alertOnFailure !== undefined ? Boolean(jobData.alertConfig.alertOnFailure) : true,
        alertOnSuccess: Boolean(jobData.alertConfig.alertOnSuccess),
        alertOnTimeout: Boolean(jobData.alertConfig.alertOnTimeout),
        failureThreshold: typeof jobData.alertConfig.failureThreshold === 'number' ? jobData.alertConfig.failureThreshold : 1,
        recoveryThreshold: typeof jobData.alertConfig.recoveryThreshold === 'number' ? jobData.alertConfig.recoveryThreshold : 1,
        customMessage: typeof jobData.alertConfig.customMessage === 'string' ? jobData.alertConfig.customMessage : "",
      } : null,
      organizationId: organizationId,
      projectId: targetProjectId,
      createdByUserId: userId, // Use authenticated user ID
      jobType: jobData.jobType === "k6" ? "k6" : "playwright",
    }).returning();

    // Validate alert configuration if enabled
    if (jobData.alertConfig?.enabled) {
      // Check if at least one notification provider is selected
      if (!jobData.alertConfig.notificationProviders || jobData.alertConfig.notificationProviders.length === 0) {
        return NextResponse.json(
          { error: "At least one notification channel must be selected when alerts are enabled" },
          { status: 400 }
        );
      }

      // Check notification channel limit
      const maxJobChannels = parseInt(process.env.NEXT_PUBLIC_MAX_JOB_NOTIFICATION_CHANNELS || '10', 10);
      if (jobData.alertConfig.notificationProviders.length > maxJobChannels) {
        return NextResponse.json(
          { error: `You can only select up to ${maxJobChannels} notification channels` },
          { status: 400 }
        );
      }

      // Check if at least one alert type is selected
      const alertTypesSelected = [
        jobData.alertConfig.alertOnFailure,
        jobData.alertConfig.alertOnSuccess,
        jobData.alertConfig.alertOnTimeout
      ].some(Boolean);

      if (!alertTypesSelected) {
        return NextResponse.json(
          { error: "At least one alert type must be selected when alerts are enabled" },
          { status: 400 }
        );
      }
    }

    // Link notification providers if alert config is enabled
    if (insertedJob && jobData.alertConfig?.enabled && Array.isArray(jobData.alertConfig.notificationProviders)) {
      await Promise.all(
        jobData.alertConfig.notificationProviders.map(providerId =>
          db.insert(jobNotificationSettings).values({
            jobId: insertedJob.id,
            notificationProviderId: providerId,
          })
        )
      );
    }

    // If tests are provided, create job-test associations
    if (jobData.tests && jobData.tests.length > 0) {
      const jobTestValues = jobData.tests.map((test) => ({
        jobId: jobId,
        testId: test.id,
      }));

      await db.insert(jobTests).values(jobTestValues);
    }

    return NextResponse.json({
      success: true,
      job: {
        id: jobId,
        name: jobData.name,
        description: jobData.description || "",
        cronSchedule: jobData.cronSchedule,
        jobType: jobData.jobType === "k6" ? "k6" : "playwright",
      },
    });
  } catch (error) {
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
    const { project, organizationId } = await requireProjectContext();

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

    // Check if job exists and belongs to current project
    const existingJob = await db
      .select({ 
        id: jobs.id, 
        projectId: jobs.projectId,
        organizationId: jobs.organizationId 
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
    if (existingJob[0].projectId !== project.id || existingJob[0].organizationId !== organizationId) {
      return NextResponse.json(
        { success: false, error: "Job not found or access denied" },
        { status: 404 }
      );
    }

    // Build permission context and check access
    // Check permission to update jobs
    const canEdit = await hasPermission('job', 'update', { organizationId, projectId: project.id });
    
    if (!canEdit) {
      return NextResponse.json(
        { error: 'Insufficient permissions to edit jobs' },
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
    if (error instanceof Error) {
      if (error.message === 'Authentication required') {
        return NextResponse.json(
          { success: false, error: 'Authentication required' },
          { status: 401 }
        );
      }
      
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { success: false, error: 'Resource not found or access denied' },
          { status: 404 }
        );
      }
    }
    
    return NextResponse.json(
      { success: false, error: "Failed to update job" },
      { status: 500 }
    );
  }
}

// Helper function to run a job
async function runJob(request: Request) {
  try {
    // Parse the job data from the request
    const data = await request.json();
    const { jobId, tests } = data;

    if (!jobId || !tests || !Array.isArray(tests) || tests.length === 0) {
      return NextResponse.json(
        { error: "Invalid job data. Job ID and tests are required." },
        { status: 400 }
      );
    }

    // Create a new test run record in the database
    const runId = crypto.randomUUID();
    const startTime = new Date();

    // Insert a new test run record
    await db.insert(runs).values({
      id: runId,
      jobId,
      status: "running",
      startedAt: startTime,
      trigger: "manual" as JobTrigger,
    });

    // Prepare test scripts for execution
    const testScripts = [];

    // Fetch test scripts for each test in the job
    for (const test of tests) {
      // If script is missing, try to fetch it
      let testScript = test.script;
      let testName = test.name || test.title || `Test ${test.id}`;

      if (!testScript) {
        // Fetch the test from the database to get the script
        const testResult = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/tests/${test.id}`);
        const testData = await testResult.json();
        if (testResult.ok && testData?.script) {
          testScript = testData.script;
          testName = testData.title || testName;
        } else {
          console.error(`Failed to fetch script for test ${test.id}`);
          // Add a placeholder for tests without scripts
          testScripts.push({
            id: test.id,
            name: testName,
            script: `
              test('Missing test script', async ({ page }) => {
                test.fail();
                console.log('Test script not found');
                expect(false).toBeTruthy();
              });
            `,
          });
          continue;
        }
      }

      // Add the test to our list
      testScripts.push({
        id: test.id,
        name: testName,
        script: testScript,
      });
    }

    // Execute all tests in a single run
    const result = await executeJob(jobId, testScripts);

    // Map individual test results for the response
    const testResults = result.results && Array.isArray(result.results) 
      ? result.results.map((testResult: TestResult) => ({
          testId: testResult.testId,
          success: testResult.success,
          error: testResult.error,
          reportUrl: result.reportUrl, // All tests share the same report URL
        }))
      : [];

    // Calculate test duration
    const startTimeMs = startTime.getTime();
    const endTime = new Date().getTime();
    const durationMs = endTime - startTimeMs;
    const durationFormatted = `${Math.floor(durationMs / 1000)}s`;

    // Update the job status in the database
    await db
      .update(jobs)
      .set({
        status: result.success
          ? ("passed" as JobStatus)
          : ("failed" as JobStatus),
        lastRunAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    // Create a separate variable for logs data that includes stdout and stderr
    const logsData = result.results && Array.isArray(result.results)
      ? result.results.map((r: TestResult) => {
          // Create a basic log entry with the test ID
          const logEntry: { testId: string; stdout: string; stderr: string } = {
            testId: r.testId,
            stdout: r.stdout?.toString() || "",
            stderr: r.stderr?.toString() || "",
          };

          // Return the log entry
          return logEntry;
        })
      : [];

    // Stringify the logs data for storage
    const logs = JSON.stringify(logsData);

    // Get error details if any tests failed
    const errorDetails = result.success
      ? null
      : JSON.stringify(
          result.results && Array.isArray(result.results) 
            ? result.results.filter((r: TestResult) => !r.success).map((r: TestResult) => r.error)
            : []
        );

    // Check if any individual tests failed - this is an additional check to ensure
    // we correctly flag runs with failed tests
    const hasFailedTests = result.results && Array.isArray(result.results) 
      ? result.results.some((r: TestResult) => !r.success)
      : false;

    // Update the test run record with results
    await db
      .update(runs)
      .set({
        status: hasFailedTests
          ? ("failed" as TestRunStatus)
          : ("passed" as TestRunStatus),
        duration: durationFormatted,
        completedAt: new Date(),
        logs: logs || "",
        errorDetails: errorDetails || "",
      })
      .where(eq(runs.id, runId));

    // Return the combined result with the run ID
    return NextResponse.json({
      jobId,
      runId,
      success: result.success,
      reportUrl: result.reportUrl,
      results: testResults,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error running job:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "An unknown error occurred",
      },
      { status: 500 }
    );
  }
}
