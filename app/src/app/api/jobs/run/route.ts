import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { runs, JobTrigger, tests, jobs } from "@/db/schema";
import type { JobType, K6Location } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import crypto from "crypto";
import {
  addJobToQueue,
  addK6JobToQueue,
  JobExecutionTask,
  K6ExecutionTask,
} from "@/lib/queue";
import { requireAuthContext, isAuthError } from '@/lib/auth-context';
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { logAuditEvent } from '@/lib/audit-logger';
import { applyVariablesToTestScripts, decodeTestScript } from "@/lib/job-execution-utils";
import { validateK6Script } from "@/lib/k6-validator";
import { subscriptionService } from "@/lib/services/subscription-service";

const DEFAULT_K6_LOCATION: K6Location = "eu-central";

const normalizeK6Location = (value?: string): K6Location => {
  const lower = value?.toLowerCase();
  // Accept kebab-case format matching K6Location type: "us-east" | "eu-central" | "asia-pacific" | "global"
  if (lower === "us-east" || lower === "eu-central" || lower === "asia-pacific" || lower === "global") {
    return lower;
  }
  return DEFAULT_K6_LOCATION;
};

export async function POST(request: Request) {
  let jobId: string | null = null;
  let runId: string | null = null;

  try {
    // Check authentication and get project context
    const authCtx = await requireAuthContext();
    const { userId, project, organizationId, isCliAuth } = authCtx;
    
    const data = await request.json();
    jobId = data.jobId as string;
    const testData = data.tests;
    const trigger = data.trigger as JobTrigger; // Requested trigger from request body
    
    // Validate trigger value
    if (!trigger || !['manual', 'remote', 'schedule'].includes(trigger)) {
      console.error("Invalid trigger value:", trigger);
      return NextResponse.json(
        { error: "Invalid trigger value. Must be one of 'manual', 'remote', or 'schedule'." },
        { status: 400 }
      );
    }

    // Normalize trigger source: CLI-initiated remote executions should always be tracked as remote.
    const effectiveTrigger: JobTrigger = isCliAuth ? "remote" : trigger;

    console.log(`Received job execution request:`, { jobId, testCount: testData?.length });
    
    if (!jobId || !testData || !Array.isArray(testData) || testData.length === 0) {
      console.error("Invalid job data:", { jobId, tests: testData });
      return NextResponse.json(
        { error: "Invalid job data. Job ID and tests are required." },
        { status: 400 }
      );
    }

    // Fetch job details to get the organization and project ID
    const jobDetails = await db
      .select({ 
        organizationId: jobs.organizationId, 
        projectId: jobs.projectId,
        jobType: jobs.jobType,
        name: jobs.name,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    
    if (jobDetails.length === 0) {
      console.error("Job not found:", jobId);
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 }
      );
    }

    // SECURITY: Verify job belongs to current project before any other checks.
    // This prevents information leakage (e.g. billing state) for jobs the caller doesn't own.
    if (jobDetails[0].projectId !== project.id) {
      console.error("Job does not belong to current project:", { jobId, jobProjectId: jobDetails[0].projectId, currentProjectId: project.id });
      return NextResponse.json(
        { error: "Job not found in current project" },
        { status: 404 }
      );
    }
    
    // Check permission to trigger jobs
    const canTriggerJobs = checkPermissionWithContext('job', 'trigger', authCtx);
    
    if (!canTriggerJobs) {
      console.warn(`User ${userId} attempted to trigger job ${jobId} without TRIGGER_JOBS permission`);
      return NextResponse.json(
        { error: "Insufficient permissions to trigger jobs" },
        { status: 403 }
      );
    }

    // SECURITY: Validate active subscription before allowing execution.
    // Use organizationId from the authenticated context to avoid IDOR.
    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    try {
      await subscriptionService.blockUntilSubscribed(organizationId);
      await subscriptionService.requireValidPolarCustomer(organizationId);
    } catch (subscriptionError) {
      const errorMessage =
        subscriptionError instanceof Error
          ? subscriptionError.message
          : "Subscription validation failed";
      return NextResponse.json(
        { error: errorMessage },
        { status: 402 }
      );
    }
    
    const jobRecord = jobDetails[0];
    const jobType = (jobRecord?.jobType || "playwright") as JobType;
    const isPerformanceJob = jobType === "k6";
    
    // Extract location from request data for all job types
    const requestedLocation = typeof data.location === "string" ? (data.location as string) : undefined;
    
    // Normalize location if needed (mainly for k6, but useful for consistency)
    const resolvedLocation = isPerformanceJob
      ? normalizeK6Location(requestedLocation)
      : undefined;

    runId = crypto.randomUUID();
    const startTime = new Date();
    
    await db.insert(runs).values({
      id: runId,
      jobId,
      projectId: jobRecord?.projectId ?? null,
      status: "queued", // Start as queued, will be updated after capacity reservation
      startedAt: startTime,
      trigger: effectiveTrigger,
      location: (resolvedLocation ?? null) as K6Location | null,
      metadata: {
        jobType,
        ...(isPerformanceJob
          ? {
              executionEngine: "k6",
              location: resolvedLocation,
            }
          : { executionEngine: "playwright" }),
      },
    });

    console.log(`[${jobId}/${runId}] Created queued run record: ${runId}`);

    // Notify listeners that this job is running

    const testScripts: Array<{ id: string; name: string; script: string; type?: string }> = [];
    
    for (const test of testData) {
      let testScript = test.script;
      let testName = test.name || test.title || `Test ${test.id}`;
      let testType: string | undefined = test.type;
      
      if (!testScript) {
        console.log(`[${jobId}/${runId}] Fetching script for test ${test.id} from database`);
        
        // Fetch test directly from database
        const testResult = await db
          .select({
            id: tests.id,
            title: tests.title,
            script: tests.script,
            type: tests.type,
          })
          .from(tests)
          .where(
            and(
              eq(tests.id, test.id),
              eq(tests.projectId, project.id),
              eq(tests.organizationId, organizationId),
            ),
          )
          .limit(1);
        
        if (testResult.length > 0 && testResult[0].script) {
          // Decode the base64 script
          testScript = await decodeTestScript(testResult[0].script);
          testName = testResult[0].title || testName;
          testType = testResult[0].type ?? testType;
        } else {
          console.error(`[${jobId}/${runId}] Failed to fetch script for test ${test.id}, skipping.`);
          continue;
        }
      }
      
      if (isPerformanceJob && testType !== "performance") {
        const errorMessage = `Test ${test.id} is not a performance test and cannot be executed in a k6 job`;
        console.error(`[${jobId}/${runId}] ${errorMessage}`);
        await db
          .update(runs)
          .set({
            status: "failed",
            completedAt: new Date(),
            errorDetails: errorMessage,
          })
          .where(eq(runs.id, runId));
        return NextResponse.json({ error: errorMessage }, { status: 400 });
      }

      if (isPerformanceJob) {
        try {
          const validation = validateK6Script(testScript);
          if (!validation.valid) {
            const errorMessage = validation.errors?.[0] || "Invalid k6 script detected for job execution";
            console.error(`[${jobId}/${runId}] ${errorMessage}`);
            await db
              .update(runs)
              .set({
                status: "failed",
                completedAt: new Date(),
                errorDetails: errorMessage,
              })
              .where(eq(runs.id, runId));
            return NextResponse.json(
              {
                error: "Invalid k6 script",
                details: validation.errors,
                warnings: validation.warnings,
              },
              { status: 400 }
            );
          }
        } catch (validationError) {
          console.error(
            `[${jobId}/${runId}] Failed to validate k6 script for test ${test.id}:`,
            validationError
          );
          await db
            .update(runs)
            .set({
              status: "failed",
              completedAt: new Date(),
              errorDetails: "Failed to validate k6 script",
            })
            .where(eq(runs.id, runId));
          return NextResponse.json(
            { error: "Failed to validate k6 script" },
            { status: 400 }
          );
        }
      }
      
      testScripts.push({ id: test.id, name: testName, script: testScript, type: testType });
    }

    if (testScripts.length === 0) {
        console.error(`[${jobId}/${runId}] No valid test scripts found after fetching. Aborting run.`);
        await db.update(runs).set({ status: "failed", completedAt: new Date(), errorDetails: "No valid test scripts found for the job." }).where(eq(runs.id, runId));
        return NextResponse.json(
            { error: "No valid test scripts could be prepared for the job." },
            { status: 400 }
        );
    }

    console.log(`[${jobId}/${runId}] Prepared ${testScripts.length} test scripts for queuing.`);

    if (isPerformanceJob && testScripts.length !== 1) {
      console.warn(
        `[${jobId}/${runId}] k6 jobs currently support exactly one performance test. Received ${testScripts.length}.`
      );
    }

    // Apply variable resolution using the unified function
    const { processedTestScripts, variableResolution } = await applyVariablesToTestScripts(
      testScripts,
      project.id,
      `[${jobId}/${runId}]`
    );

    try {
      if (isPerformanceJob) {
        const primaryScript = processedTestScripts[0]?.script ?? "";
        const primaryTestId = processedTestScripts[0]?.id ?? testScripts[0]?.id;

        if (!primaryScript || !primaryTestId) {
          const errorMessage = "Unable to prepare k6 script for execution";
          console.error(`[${jobId}/${runId}] ${errorMessage}`);
          await db
            .update(runs)
            .set({
              status: "failed",
              completedAt: new Date(),
              errorDetails: errorMessage,
            })
            .where(eq(runs.id, runId));
          return NextResponse.json({ error: errorMessage }, { status: 400 });
        }

        const k6Task: K6ExecutionTask = {
          runId,
          jobId,
          testId: primaryTestId,
          script: primaryScript,
          variables: variableResolution.variables,
          secrets: variableResolution.secrets,
          tests: processedTestScripts.map((script) => ({
            id: script.id,
            script: script.script,
          })),
          organizationId: jobRecord?.organizationId ?? "",
          projectId: jobRecord?.projectId ?? "",
          location: resolvedLocation ?? DEFAULT_K6_LOCATION,
          jobType,
        };

        const queueResult = await addK6JobToQueue(k6Task, "k6-job-execution");
        
        // Update run status based on actual queue result
        await db.update(runs)
          .set({ status: queueResult.status })
          .where(eq(runs.id, runId));
          
        console.log(`[${jobId}/${runId}] K6 job ${queueResult.status} (position: ${queueResult.position ?? 'N/A'})`);
      } else {
        const task: JobExecutionTask = {
          jobId: jobId,
          testScripts: processedTestScripts,
          runId: runId,
          originalJobId: jobId,
          trigger: effectiveTrigger,
          organizationId: jobRecord?.organizationId || "",
          projectId: jobRecord?.projectId || "",
          variables: variableResolution.variables,
          secrets: variableResolution.secrets,
          jobType,
        };

        const queueResult = await addJobToQueue(task);
        
        // Update run status based on actual queue result
        await db.update(runs)
          .set({ status: queueResult.status })
          .where(eq(runs.id, runId));
          
        console.log(`[${jobId}/${runId}] Playwright job ${queueResult.status} (position: ${queueResult.position ?? 'N/A'})`);
      }
      
      // Log the audit event for job execution trigger
      await logAuditEvent({
        userId,
        organizationId,
        action: 'job_triggered',
        resource: 'job',
        resourceId: jobId,
        metadata: {
          runId,
          trigger: effectiveTrigger,
          testsCount: testScripts.length,
          projectId: project.id,
          projectName: project.name,
          jobType,
          executionEngine: isPerformanceJob ? "k6" : "playwright",
          location: resolvedLocation ?? undefined,
        },
        success: true
      });
      
    } catch (error) {
      // Check if this is a queue capacity error
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('capacity limit') || errorMessage.includes('Unable to verify queue capacity')) {
        console.log(`[Job API] Capacity limit reached: ${errorMessage}`);
        
        // Update the run status to failed with capacity limit error
        await db.update(runs)
          .set({
            status: "failed",
            completedAt: new Date(),
            errorDetails: errorMessage
          })
          .where(eq(runs.id, runId));
          
        // Return a 429 status code (Too Many Requests) with the error message
        return NextResponse.json(
          { error: "Queue capacity limit reached", message: errorMessage },
          { status: 429 }
        );
      }
      
      // For other errors, log and return a 500 status code
      console.error(`[${jobId}/${runId}] Error processing job:`, error);
      
      // Re-throw for other errors to be caught by the main catch block
      throw error;
    }

    return NextResponse.json({
      message: "Job execution queued successfully.",
      jobId: jobId,
      runId: runId,
    });
  } catch (error) {
    console.error(`[${jobId || 'unknown'}/${runId || 'unknown'}] Error queuing job:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";

    // Handle authentication/authorization errors
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: 401 }
      );
    }
    
    if (errorMessage.includes('No active project found') || errorMessage.includes('not found')) {
      return NextResponse.json(
        { error: 'Project access denied or not found' },
        { status: 404 }
      );
    }

    if (runId) {
      try {
        await db.update(runs)
          .set({
            status: "failed",
            completedAt: new Date(),
            errorDetails: `Failed to queue job: ${errorMessage}`
          })
          .where(eq(runs.id, runId));
      } catch (dbError) {
        console.error(`[${jobId || 'unknown'}/${runId}] Failed to update run status to failed after queueing error:`, dbError);
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: `Failed to queue job execution: ${errorMessage}`,
        jobId: jobId,
        runId: runId,
      },
      { status: 500 }
    );
  }
}
