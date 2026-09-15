import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import {
  addK6TestToQueue,
  addTestToQueue,
  K6ExecutionTask,
  TestExecutionTask,
} from "@/lib/queue";
import { playwrightValidationService } from "@/lib/playwright-validator";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { resolveProjectVariables, extractVariableNames, type VariableResolutionResult } from "@/lib/variable-resolver";
import { isK6Script, validateK6Script } from "@/lib/k6-validator";
import { db } from "@/utils/db";
import { runs, type K6Location } from "@/db/schema";
import { resolveProjectK6Location } from "@/lib/location-registry";
import { polarUsageService } from "@/lib/services/polar-usage.service";
import { buildBillingBlockedResponse } from "@/lib/billing-errors";
import { checkExecutionRateLimit } from "@/lib/execution-rate-limiter";
import {
  buildExecutionQueueErrorResponse,
  buildExecutionRateLimitResponse,
  getSafeExecutionQueueErrorDetails,
} from "@/lib/execution-api-responses";
import { requireSameOriginRequest } from "@/lib/security/same-origin";

function buildReportProxyUrl(entityId: string): string {
  return `/api/test-results/${encodeURIComponent(entityId)}/report/index.html?forceIframe=true`;
}

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  try {
    // Check authentication and permissions first
    const authCtx = await requireAuthContext();
    const { userId, project, organizationId } = authCtx;

    // Check permission to run tests
    const canRunTests = checkPermissionWithContext('test', 'run', authCtx);
    
	    if (!canRunTests) {
	      console.warn(`User ${userId} attempted to run playground test without RUN_TESTS permission`);
	      return NextResponse.json(
	        { error: "Insufficient permissions to run tests. Only editors and admins can execute tests from the playground." },
	        { status: 403 }
	      );
	    }

	    const spendingBlock = await polarUsageService.shouldBlockUsage(organizationId);
	    if (spendingBlock.blocked) {
	      return NextResponse.json(
	        buildBillingBlockedResponse(spendingBlock.reason),
	        { status: 402 }
	      );
	    }

    const rateLimitResponse = buildExecutionRateLimitResponse(
      await checkExecutionRateLimit(userId, organizationId),
    );
    if (rateLimitResponse) return rateLimitResponse;

    let data;
    try {
      data = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const code = typeof data.script === "string" ? data.script : "";
    const requestedLocation = typeof data.location === "string" ? data.location : undefined;

    if (!code.trim()) {
      return NextResponse.json(
        { error: "No script provided" },
        { status: 400 }
      );
    }

    // Validate the script first - only queue if validation passes
    console.log("Validating script before queuing...");
    try {
      const validationResult = playwrightValidationService.validateCode(code, {
        selectedTestType: data.testType,
      });
      
      if (!validationResult.valid) {
        console.warn("Script validation failed:", validationResult.error);
        return NextResponse.json({
          error: "Script validation failed",
          validationError: validationResult.error,
          line: validationResult.line,
          column: validationResult.column,
          errorType: validationResult.errorType,
          isValidationError: true,
        }, { status: 400 });
      }
      
      console.log("Script validation passed, proceeding to queue test...");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      console.error("Validation service error:", errorMessage);
      return NextResponse.json({
        error: "Script validation failed",
        validationError: `Validation service error: ${errorMessage}`,
        isValidationError: true,
      }, { status: 500 });
    }

    const testId = crypto.randomUUID();

    // Detect if this is a k6 performance test
    const isPerformanceTest = isK6Script(code);
    const testType = isPerformanceTest ? "performance" : "browser";

    let executionLocation: K6Location | undefined;
    if (isPerformanceTest) {
      try {
        executionLocation = (await resolveProjectK6Location(
          project.id,
          requestedLocation
        )) as K6Location;
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Invalid location requested",
          },
          { status: 400 }
        );
      }
    }

    let runIdForQueue: string | null = null;

    // Validate k6 script if it's a performance test
    if (isPerformanceTest) {
        const k6Validation = validateK6Script(code, {
          selectedTestType: data.testType,
        });
      if (!k6Validation.valid) {
        return NextResponse.json({
          error: "k6 script validation failed",
          validationError: k6Validation.errors.join(', '),
          warnings: k6Validation.warnings,
          isValidationError: true,
        }, { status: 400 });
      }
    }

    // Resolve variables and secrets for both Playwright and k6 tests.
    // Helper injection happens in worker runtime to avoid embedding secret values in script source.
    let scriptToExecute = code;
    let variableResolution: VariableResolutionResult = {
      variables: {},
      secrets: {},
      files: {},
      errors: [],
    };
    let usedVariables: string[] = [];
    let missingVariables: string[] = [];

    console.log("Resolving project variables...");
    variableResolution = await resolveProjectVariables(project.id);

    if (variableResolution.errors && variableResolution.errors.length > 0) {
      console.warn("Variable resolution errors:", variableResolution.errors);
      // Continue execution but log warnings
    }

    // Extract variable names used in the script for validation
    usedVariables = extractVariableNames(code);
    console.log(`Script uses ${usedVariables.length} variables: ${usedVariables.join(', ')}`);

    // Check if all used variables are available (check both variables and secrets)
    missingVariables = usedVariables.filter(varName =>
      !variableResolution.variables.hasOwnProperty(varName) &&
      !variableResolution.secrets.hasOwnProperty(varName)
    );
    if (missingVariables.length > 0) {
      console.warn(`Script references undefined variables: ${missingVariables.join(', ')}`);
      // We'll continue execution and let getVariable/getSecret handle missing variables with defaults
    }

    let resolvedLocation: K6Location | null = null;

    try {
      // executionLocation is already resolved by resolveProjectK6Location (always returns a
      // valid string). The null branch covers non-performance tests.
      resolvedLocation = isPerformanceTest
        ? (executionLocation ?? null)
        : null;

      if (isPerformanceTest) {
        const [createdRun] = await db
          .insert(runs)
          .values({
            id: crypto.randomUUID(),
            jobId: null,
            projectId: project.id,
            status: "queued", // Start as queued, updated after capacity reservation
            trigger: "manual",
            location: resolvedLocation,
            metadata: {
              source: "playground",
              testType,
              testId,
              location: resolvedLocation,
            },
            startedAt: new Date(),
          })
          .returning({ id: runs.id });

        runIdForQueue = createdRun.id;
      } else {
        // Create run record for Playwright tests too
        const [createdRun] = await db
          .insert(runs)
          .values({
            id: crypto.randomUUID(),
            jobId: null,
            projectId: project.id,
            status: "queued", // Start as queued, updated after capacity reservation
            trigger: "manual",
            location: null,
            metadata: {
              source: "playground",
              testType,
              testId,
            },
            startedAt: new Date(),
          })
          .returning({ id: runs.id });

        runIdForQueue = createdRun.id;
      }

      if (isPerformanceTest) {
        const performanceTask: K6ExecutionTask = {
          runId: runIdForQueue || testId,
          jobId: null,
          testId,
          script: code,
          variables: variableResolution.variables,
          secrets: variableResolution.secrets,
          files: variableResolution.files,
          tests: [{ id: testId, script: code }],
          organizationId,
          projectId: project.id,
          location: resolvedLocation,
        };

        const queueResult = await addK6TestToQueue(performanceTask, 'k6-playground-execution');
        
        // Update run status based on actual queue result
        if (runIdForQueue) {
          try {
            await db
              .update(runs)
              .set({ status: queueResult.status })
              .where(eq(runs.id, runIdForQueue));
          } catch (statusError) {
            console.error(
              `[Test API] Failed to persist admitted run status for ${runIdForQueue}:`,
              statusError,
            );
          }
        }
      } else {
        // Route to Playwright test-execution queue
        const task: TestExecutionTask = {
          testId,
          code: scriptToExecute,
          variables: variableResolution.variables,
          secrets: variableResolution.secrets,
          files: variableResolution.files,
          runId: runIdForQueue || testId,
          organizationId,
          projectId: project.id,
        };

        const queueResult = await addTestToQueue(task);
        
        // Update run status based on actual queue result
        if (runIdForQueue) {
          try {
            await db
              .update(runs)
              .set({ status: queueResult.status })
              .where(eq(runs.id, runIdForQueue));
          } catch (statusError) {
            console.error(
              `[Test API] Failed to persist admitted run status for ${runIdForQueue}:`,
              statusError,
            );
          }
        }
      }

      // The execution is already admitted at this point. Audit persistence is
      // best-effort so an audit backend failure cannot turn an accepted run
      // into a false enqueue failure or incorrectly mark it as failed.
      try {
        await logAuditEvent({
          userId,
          organizationId,
          action: "playground_test_executed",
          resource: "test",
          resourceId: testId,
          metadata: {
            projectId: project.id,
            projectName: project.name,
            scriptLength: code.length,
            executionMethod: "playground",
            testType: testType,
            runId: runIdForQueue || testId,
            location: resolvedLocation ?? undefined,
            variablesCount:
              Object.keys(variableResolution.variables).length +
              Object.keys(variableResolution.secrets).length,
            usedVariables: usedVariables,
            missingVariables:
              missingVariables.length > 0 ? missingVariables : undefined,
          },
          success: true,
        });
      } catch (auditError) {
        console.error(
          `[Test API] Failed to record audit event for admitted run ${runIdForQueue}:`,
          auditError,
        );
      }
    } catch (error) {
      if (runIdForQueue) {
        try {
          await db
            .update(runs)
            .set({
              status: "failed",
              completedAt: new Date(),
              errorDetails: getSafeExecutionQueueErrorDetails(error),
            })
            .where(eq(runs.id, runIdForQueue));
        } catch (statusError) {
          console.error(
            `[Test API] Failed to finalize rejected run ${runIdForQueue}:`,
            statusError,
          );
        }
      }

      const queueErrorResponse = buildExecutionQueueErrorResponse(error);
      if (queueErrorResponse) return queueErrorResponse;

      console.error("Error adding test to queue:", error);
      return NextResponse.json(
        { error: "Failed to queue test for execution" },
        { status: 500 },
      );
    }

    // Return a stable internal report proxy URL for backward compatibility.
    // Playwright playground reports are keyed by ephemeral testId (worker
    // stores reports.entityId = testId); k6 reports are keyed by run id.
    // /api/test-results authorizes playground testIds via runs.metadata.testId.
    const reportEntityId = isPerformanceTest
      ? runIdForQueue || testId
      : testId;
    const reportUrl = buildReportProxyUrl(reportEntityId);
    const statusUrl = runIdForQueue ? `/api/runs/${runIdForQueue}/status` : null;

    return NextResponse.json({
      message: "Test execution queued successfully.",
      testId: testId,
      reportUrl: reportUrl,
      statusUrl,
      testType: testType, // Include test type so frontend knows if it's k6 or Playwright
      runId: runIdForQueue || testId,
      location: resolvedLocation ?? undefined,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error processing test request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
