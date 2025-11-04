import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { runs, JobTrigger, tests, jobs } from "@/db/schema";
import type { JobType, K6Location } from "@/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import {
  addJobToQueue,
  addK6JobToQueue,
  JobExecutionTask,
  K6ExecutionTask,
} from "@/lib/queue";
import { requireProjectContext } from '@/lib/project-context';
import { hasPermission } from '@/lib/rbac/middleware';
import { logAuditEvent } from '@/lib/audit-logger';
import { applyVariablesToTestScripts, decodeTestScript } from "@/lib/job-execution-utils";
import { validateK6Script } from "@/lib/k6-validator";

const DEFAULT_K6_LOCATION: K6Location = "us-east";

const normalizeK6Location = (value?: string): K6Location => {
  if (value === "us-east" || value === "eu-central" || value === "asia-pacific") {
    return value;
  }
  return DEFAULT_K6_LOCATION;
};

export async function POST(request: Request) {
  let jobId: string | null = null;
  let runId: string | null = null;

  try {
    // Check authentication and get project context
    const { userId, project, organizationId } = await requireProjectContext();
    
    const data = await request.json();
    jobId = data.jobId as string;
    const testData = data.tests;
    const trigger = data.trigger as JobTrigger; // Get trigger from request body
    
    // Validate trigger value
    if (!trigger || !['manual', 'remote', 'schedule'].includes(trigger)) {
      console.error("Invalid trigger value:", trigger);
      return NextResponse.json(
        { error: "Invalid trigger value. Must be one of 'manual', 'remote', or 'schedule'." },
        { status: 400 }
      );
    }

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
    
    // Verify job belongs to current project
    if (jobDetails[0].projectId !== project.id) {
      console.error("Job does not belong to current project:", { jobId, jobProjectId: jobDetails[0].projectId, currentProjectId: project.id });
      return NextResponse.json(
        { error: "Job not found in current project" },
        { status: 404 }
      );
    }
    
    // Check permission to trigger jobs
    const canTriggerJobs = await hasPermission('job', 'trigger', { organizationId, projectId: project.id });
    
    if (!canTriggerJobs) {
      console.warn(`User ${userId} attempted to trigger job ${jobId} without TRIGGER_JOBS permission`);
      return NextResponse.json(
        { error: "Insufficient permissions to trigger jobs" },
        { status: 403 }
      );
    }
    
    const jobRecord = jobDetails[0];
    const jobType = (jobRecord?.jobType || "playwright") as JobType;
    const isPerformanceJob = jobType === "k6";
    const requestedLocation =
      isPerformanceJob && typeof data.location === "string"
        ? (data.location as string)
        : undefined;
    const resolvedLocation = isPerformanceJob
      ? normalizeK6Location(requestedLocation)
      : null;

    runId = crypto.randomUUID();
    const startTime = new Date();
    
    await db.insert(runs).values({
      id: runId,
      jobId,
      projectId: jobRecord?.projectId ?? null,
      status: "running",
      startedAt: startTime,
      trigger, // Include trigger value
      location: resolvedLocation,
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

    console.log(`[${jobId}/${runId}] Created running test run record: ${runId}`);

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
          .where(eq(tests.id, test.id))
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
          tests: processedTestScripts.map((script) => ({
            id: script.id,
            script: script.script,
          })),
          organizationId: jobRecord?.organizationId ?? "",
          projectId: jobRecord?.projectId ?? "",
          location: resolvedLocation ?? DEFAULT_K6_LOCATION,
          jobType,
        };

        await addK6JobToQueue(k6Task, "k6-job-execution");
      } else {
        const task: JobExecutionTask = {
          jobId: jobId,
          testScripts: processedTestScripts,
          runId: runId,
          originalJobId: jobId,
          trigger: trigger,
          organizationId: jobRecord?.organizationId || "",
          projectId: jobRecord?.projectId || "",
          variables: variableResolution.variables,
          secrets: variableResolution.secrets,
          jobType,
        };

        await addJobToQueue(task);
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
          trigger,
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
    if (errorMessage === 'Authentication required') {
      return NextResponse.json(
        { error: 'Authentication required' },
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
