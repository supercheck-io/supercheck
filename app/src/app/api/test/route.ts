import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  addK6TestToQueue,
  addTestToQueue,
  K6ExecutionTask,
  TestExecutionTask,
} from "@/lib/queue";
import { playwrightValidationService } from "@/lib/playwright-validator";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { resolveProjectVariables, extractVariableNames, generateVariableFunctions, type VariableResolutionResult } from "@/lib/variable-resolver";
import { validateK6Script } from "@/lib/k6-validator";
import { db } from "@/utils/db";
import { runs, type K6Location } from "@/db/schema";

// Helper function to detect if a script is a k6 performance test
function isK6Script(script: string): boolean {
  // Check for k6 imports
  return /import\s+.*\s+from\s+['"]k6(\/[^'"]+)?['"]/.test(script);
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication and permissions first
    const { userId, project, organizationId } = await requireProjectContext();

    // Check permission to run tests
    const canRunTests = await hasPermission('test', 'create', {
      organizationId,
      projectId: project.id
    });
    
    if (!canRunTests) {
      console.warn(`User ${userId} attempted to run playground test without RUN_TESTS permission`);
      return NextResponse.json(
        { error: "Insufficient permissions to run tests. Only editors and admins can execute tests from the playground." },
        { status: 403 }
      );
    }

    const data = await request.json();
    const code = data.script as string;
    const requestedLocation = typeof data.location === "string" ? data.location : undefined;

    if (!code) {
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

    const normalizeLocation = (value?: string): K6Location => {
          const lower = value?.toLowerCase();
          // Accept kebab-case format matching K6Location type: "us-east" | "eu-central" | "asia-pacific" | "global"
          if (lower === "us-east" || lower === "eu-central" || lower === "asia-pacific" || lower === "global") {
            return lower;
          }
          // Default to global for any other value with warning
          console.warn(`[LOCATION WARNING] Invalid location "${value}" received, defaulting to "global". Valid locations: us-east, eu-central, asia-pacific, global`);
          return "global";
        };

    const executionLocation: K6Location | undefined = isPerformanceTest
      ? normalizeLocation(requestedLocation)
      : undefined;

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

    // For k6 tests, skip variable resolution (k6 doesn't support it)
    let scriptToExecute = code;
    let variableResolution: VariableResolutionResult = {
      variables: {},
      secrets: {},
      errors: [],
    };
    let usedVariables: string[] = [];
    let missingVariables: string[] = [];

    if (!isPerformanceTest) {
      // Only resolve variables for Playwright tests
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

      // Generate both getVariable and getSecret function implementations
      const variableFunctionCode = generateVariableFunctions(variableResolution.variables, variableResolution.secrets);

      // Prepend the variable functions to the user's script
      scriptToExecute = variableFunctionCode + '\n' + code;
    }

    let resolvedLocation: K6Location | null = null;

    try {
      resolvedLocation = isPerformanceTest
        ? executionLocation ?? "global"
        : null;

      if (isPerformanceTest) {
        const [createdRun] = await db
          .insert(runs)
          .values({
            id: crypto.randomUUID(),
            jobId: null,
            projectId: project.id,
            status: "running",
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
      }

      if (isPerformanceTest) {
        const performanceTask: K6ExecutionTask = {
          runId: runIdForQueue || testId,
          jobId: null,
          testId,
          script: code,
          tests: [{ id: testId, script: code }],
          organizationId,
          projectId: project.id,
          location: resolvedLocation ?? "global",
        };

        await addK6TestToQueue(performanceTask, 'k6-playground-execution');
      } else {
        // Route to Playwright test-execution queue
        const task: TestExecutionTask = {
          testId,
          code: scriptToExecute,
          variables: variableResolution.variables,
          secrets: variableResolution.secrets,
          runId: runIdForQueue || testId,
          organizationId,
          projectId: project.id,
        };

        await addTestToQueue(task);
      }
      
      // Log the audit event for playground test execution
      await logAuditEvent({
        userId,
        organizationId,
        action: 'playground_test_executed',
        resource: 'test',
        resourceId: testId,
        metadata: {
          projectId: project.id,
          projectName: project.name,
          scriptLength: code.length,
          executionMethod: 'playground',
          testType: testType,
          runId: runIdForQueue || testId,
          location: resolvedLocation ?? undefined,
          variablesCount: Object.keys(variableResolution.variables).length + Object.keys(variableResolution.secrets).length,
          usedVariables: usedVariables,
          missingVariables: missingVariables.length > 0 ? missingVariables : undefined
        },
        success: true
      });
      
    } catch (error) {
      // Check if this is a queue capacity error
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('capacity limit') || errorMessage.includes('Unable to verify queue capacity')) {
        console.log(`[Test API] Capacity limit reached: ${errorMessage}`);
        
        // Return a 429 status code (Too Many Requests) with the error message
        return NextResponse.json(
          { error: "Queue capacity limit reached", message: errorMessage },
          { status: 429 }
        );
      }
      
      // For other errors, log and return a 500 status code
      console.error("Error adding test to queue:", error);
      return NextResponse.json(
        { error: "Failed to queue test for execution", details: errorMessage },
        { status: 500 }
      );
    }

    // Include the reportUrl in the response using direct UUID path
    const reportUrl = `/api/test-results/${testId}/report/index.html`;

    return NextResponse.json({
      message: "Test execution queued successfully.",
      testId: testId,
      reportUrl: reportUrl,
      testType: testType, // Include test type so frontend knows if it's k6 or Playwright
      runId: runIdForQueue || testId,
      location: resolvedLocation ?? undefined,
    });
  } catch (error) {
    console.error("Error processing test request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
