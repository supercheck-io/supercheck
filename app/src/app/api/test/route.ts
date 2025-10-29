import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { addTestToQueue, TestExecutionTask } from "@/lib/queue";
import { validationService } from "@/lib/validation-service";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { resolveProjectVariables, extractVariableNames, generateVariableFunctions } from "@/lib/variable-resolver";

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

    if (!code) {
      return NextResponse.json(
        { error: "No script provided" },
        { status: 400 }
      );
    }

    // Validate the script first - only queue if validation passes
    console.log("Validating script before queuing...");
    try {
      const validationResult = validationService.validateCode(code);
      
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

    // Resolve variables for the project
    console.log("Resolving project variables...");
    const variableResolution = await resolveProjectVariables(project.id);
    
    if (variableResolution.errors && variableResolution.errors.length > 0) {
      console.warn("Variable resolution errors:", variableResolution.errors);
      // Continue execution but log warnings
    }
    
    // Extract variable names used in the script for validation
    const usedVariables = extractVariableNames(code);
    console.log(`Script uses ${usedVariables.length} variables: ${usedVariables.join(', ')}`);
    
    // Check if all used variables are available (check both variables and secrets)
    const missingVariables = usedVariables.filter(varName => 
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
    const scriptWithVariables = variableFunctionCode + '\n' + code;

    const task: TestExecutionTask = {
      testId,
      code: scriptWithVariables,
      variables: variableResolution.variables,
      secrets: variableResolution.secrets,
    };

    try {
      await addTestToQueue(task);
      
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
      reportUrl: reportUrl
    });
  } catch (error) {
    console.error("Error processing test request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
