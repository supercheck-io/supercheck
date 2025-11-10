import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { jobs, apikey, runs, JobTrigger } from "@/db/schema";
import type { JobType, K6Location } from "@/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import {
  addJobToQueue,
  addK6JobToQueue,
  JobExecutionTask,
  K6ExecutionTask,
} from "@/lib/queue";
import { prepareJobTestScripts } from "@/lib/job-execution-utils";
import { validateK6Script } from "@/lib/k6-validator";

const DEFAULT_K6_LOCATION: K6Location = "us-east";

const normalizeK6Location = (value?: string): K6Location => {
  if (value === "us-east" || value === "eu-central" || value === "asia-pacific") {
    return value;
  }
  return DEFAULT_K6_LOCATION;
};

// POST /api/jobs/[id]/trigger - Trigger job remotely via API key
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let apiKeyUsed: string | null = null;
  
  try {
    const { id } = await params;
    const jobId = id;

    // Validate UUID format for job ID
    if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      return NextResponse.json(
        { 
          error: "Invalid job ID format", 
          message: "Job ID must be a valid UUID" 
        },
        { status: 400 }
      );
    }

    // Get API key from headers (Bearer token only)
    const authHeader = request.headers.get("authorization");
    const apiKeyFromHeader = authHeader?.replace(/^Bearer\s+/i, "");

    if (!apiKeyFromHeader) {
      return NextResponse.json(
        { 
          error: "API key required", 
          message: "Include API key as Bearer token in Authorization header" 
        },
        { status: 401 }
      );
    }

    // Basic API key format validation
    const trimmedApiKey = apiKeyFromHeader.trim();
    if (!trimmedApiKey || trimmedApiKey.length < 10) {
      return NextResponse.json(
        { 
          error: "Invalid API key format", 
          message: "API key must be at least 10 characters long" 
        },
        { status: 401 }
      );
    }

    apiKeyUsed = trimmedApiKey.substring(0, 8); // For logging purposes

    // Verify the API key exists and get associated information
    const apiKeyResult = await db
      .select({
        id: apikey.id,
        name: apikey.name,
        enabled: apikey.enabled,
        expiresAt: apikey.expiresAt,
        jobId: apikey.jobId,
        userId: apikey.userId,
        lastRequest: apikey.lastRequest,
        requestCount: apikey.requestCount,
      })
      .from(apikey)
      .where(eq(apikey.key, trimmedApiKey))
      .limit(1);

    if (apiKeyResult.length === 0) {
      console.warn(`Invalid API key attempted: ${apiKeyUsed}... for job ${jobId}`);
      return NextResponse.json(
        { 
          error: "Invalid API key", 
          message: "The provided API key is invalid or has been revoked" 
        },
        { status: 401 }
      );
    }

    const key = apiKeyResult[0];

    // Check if API key is enabled
    if (!key.enabled) {
      console.warn(`Disabled API key attempted: ${key.name} (${key.id}) for job ${jobId}`);
      return NextResponse.json(
        { 
          error: "API key disabled", 
          message: "This API key has been disabled" 
        },
        { status: 401 }
      );
    }

    // Check if API key has expired
    if (key.expiresAt && new Date() > key.expiresAt) {
      console.warn(`Expired API key attempted: ${key.name} (${key.id}) for job ${jobId}`);
      return NextResponse.json(
        { 
          error: "API key expired", 
          message: `This API key expired on ${key.expiresAt.toISOString()}` 
        },
        { status: 401 }
      );
    }

    // Validate that the API key is authorized for this specific job
    if (key.jobId !== jobId) {
      console.warn(`API key unauthorized for job: ${key.name} attempted job ${jobId}, authorized for ${key.jobId}`);
      return NextResponse.json(
        { 
          error: "API key not authorized for this job", 
          message: "This API key does not have permission to trigger this job" 
        },
        { status: 403 }
      );
    }

    // Check if job exists and is in a valid state
    const jobResult = await db
      .select({
        id: jobs.id,
        name: jobs.name,
        status: jobs.status,
        createdByUserId: jobs.createdByUserId,
        organizationId: jobs.organizationId,
        projectId: jobs.projectId,
        jobType: jobs.jobType,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (jobResult.length === 0) {
      return NextResponse.json(
        { error: "Job not found", message: "The specified job does not exist" },
        { status: 404 }
      );
    }

    const job = jobResult[0];

    // Additional validation: ensure job is not in an error state that prevents triggering
    if (job.status === 'error') {
      return NextResponse.json(
        { 
          error: "Job not available", 
          message: `Job is currently in error state and cannot be triggered` 
        },
        { status: 400 }
      );
    }

    const jobType = (job.jobType || "playwright") as JobType;
    const isPerformanceJob = jobType === "k6";
    const locationParam = isPerformanceJob
      ? request.nextUrl.searchParams.get("location") ?? undefined
      : undefined;
    const resolvedLocation = isPerformanceJob
      ? normalizeK6Location(locationParam)
      : null;

    // Parse optional request body for additional parameters (currently not used but reserved for future features)
    try {
      const body = await request.text();
      if (body && body.trim()) {
        JSON.parse(body); // Validate JSON format but don't store
      }
    } catch {
      // Ignore JSON parsing errors for optional body
      console.warn(`Invalid JSON in trigger request body for job ${jobId}, proceeding with defaults`);
    }

    // Update API key usage statistics asynchronously
    const now = new Date();
    const currentCount = parseInt(key.requestCount || '0', 10);
    db.update(apikey)
      .set({ 
        lastRequest: now,
        requestCount: (currentCount + 1).toString(),
      })
      .where(eq(apikey.id, key.id))
      .catch((error) => {
        console.error(`Failed to update API key usage for ${key.id}:`, error);
      });

    // Create run record
    const runId = crypto.randomUUID();
    const startTime = new Date();
    
    await db.insert(runs).values({
      id: runId,
      jobId,
      projectId: job.projectId,
      status: "running",
      startedAt: startTime,
      trigger: "remote" as JobTrigger,
      location: resolvedLocation,
      metadata: {
        jobType,
        source: "api-trigger",
        ...(isPerformanceJob
          ? { executionEngine: "k6", location: resolvedLocation }
          : { executionEngine: "playwright" }),
      },
    });

    console.log(`[${jobId}/${runId}] Created running test run record: ${runId}`);


    // Use unified test script preparation with proper variable resolution
    const { testScripts: processedTestScripts, variableResolution } = await prepareJobTestScripts(
      jobId,
      job.projectId || '',
      runId,
      `[${jobId}/${runId}]`
    );

    try {
      if (isPerformanceJob) {
        const primaryScript = processedTestScripts[0]?.script ?? "";
        const primaryTestId = processedTestScripts[0]?.id;
        const primaryType = processedTestScripts[0]?.type;

        if (!primaryTestId || !primaryScript) {
          await db
            .update(runs)
            .set({
              status: "failed",
              completedAt: new Date(),
              errorDetails: "Unable to prepare k6 script for execution",
            })
            .where(eq(runs.id, runId));

          return NextResponse.json(
            { error: "Unable to prepare k6 script for execution" },
            { status: 400 }
          );
        }

        if (primaryType && primaryType !== "performance") {
          await db
            .update(runs)
            .set({
              status: "failed",
              completedAt: new Date(),
              errorDetails: "k6 jobs require performance tests",
            })
            .where(eq(runs.id, runId));

          return NextResponse.json(
            { error: "k6 jobs require performance tests" },
            { status: 400 }
          );
        }

        try {
          const validation = validateK6Script(primaryScript);
          if (!validation.valid) {
            await db
              .update(runs)
              .set({
                status: "failed",
                completedAt: new Date(),
                errorDetails: validation.errors?.[0] || "Invalid k6 script",
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
            `[${jobId}/${runId}] Failed to validate k6 script:`,
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

        const k6Task: K6ExecutionTask = {
          runId,
          jobId,
          jobName: job.name, // Add job name for trace identification
          testId: primaryTestId,
          testName: processedTestScripts[0]?.name, // Add test name for trace identification
          script: primaryScript,
          tests: processedTestScripts.map((script) => ({
            id: script.id,
            script: script.script,
          })),
          organizationId: job.organizationId ?? "",
          projectId: job.projectId ?? "",
          location: resolvedLocation ?? DEFAULT_K6_LOCATION,
        };

        await addK6JobToQueue(k6Task, "k6-job-execution");
      } else {
        const task: JobExecutionTask = {
          jobId: jobId,
          jobName: job.name, // Add job name for trace identification
          testScripts: processedTestScripts,
          runId: runId,
          originalJobId: jobId,
          trigger: "remote",
          organizationId: job.organizationId || "",
          projectId: job.projectId || "",
          variables: variableResolution.variables,
          secrets: variableResolution.secrets,
          jobType,
        };

        await addJobToQueue(task);
      }
    } catch (error) {
      // Check if this is a queue capacity error
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('capacity limit') || errorMessage.includes('Unable to verify queue capacity')) {
        console.log(`[Job Trigger API] Capacity limit reached: ${errorMessage}`);
        
        // Update the run status to failed with capacity limit error
        await db.update(runs)
          .set({
            status: "failed",
            completedAt: new Date(),
            errorDetails: errorMessage
          })
          .where(eq(runs.id, runId));
          
        return NextResponse.json(
          { error: "Queue capacity limit reached", message: errorMessage },
          { status: 429 }
        );
      }
      
      // For other errors, log and re-throw
      console.error(`[${jobId}/${runId}] Error adding job to queue:`, error);
      throw error;
    }

    // Log successful API key usage
    console.log(`Job ${jobId} triggered successfully via API key ${key.name} (${key.id})`);

    return NextResponse.json({
      success: true,
      message: "Job triggered successfully",
      data: {
        jobId: jobId,
        jobName: job.name,
        runId: runId,
        testCount: processedTestScripts.length,
        triggeredBy: key.name,
        triggeredAt: now.toISOString(),
      },
    });

  } catch (error) {
    console.error(`Error triggering job via API key ${apiKeyUsed}...:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
    
    return NextResponse.json(
      { 
        error: "Failed to trigger job", 
        message: errorMessage,
        details: null
      },
      { status: 500 }
    );
  }
}

// GET /api/jobs/[id]/trigger - Get trigger information
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;

    // Validate UUID format
    if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      return NextResponse.json(
        { error: "Invalid job ID format" },
        { status: 400 }
      );
    }

    // Get job information
    const jobResult = await db
      .select({
        id: jobs.id,
        name: jobs.name,
        status: jobs.status,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (jobResult.length === 0) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 }
      );
    }

    const job = jobResult[0];
    const triggerUrl = `${process.env.NEXT_PUBLIC_BASE_URL || request.nextUrl.origin}/api/jobs/${jobId}/trigger`;

    return NextResponse.json({
      success: true,
      job: {
        id: job.id,
        name: job.name,
        status: job.status,
      },
      triggerUrl,
      documentation: {
        method: "POST",
        headers: {
          "x-api-key": "your-api-key-here",
          "Content-Type": "application/json"
        },
        description: "Trigger this job remotely using your API key"
      }
    });

  } catch (error) {
    console.error("Error getting trigger information:", error);
    return NextResponse.json(
      { error: "Failed to get trigger information" },
      { status: 500 }
    );
  }
}
