import { NextRequest, NextResponse } from "next/server";
import type { TestType } from "@/db/schema/types";
import { playwrightValidationService } from "@/lib/playwright-validator";
import { isK6Script, validateK6Script } from "@/lib/k6-validator";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require authentication to prevent abuse (DoS via expensive validation)
    try {
      await requireAuthContext();
    } catch (error) {
      if (isAuthError(error)) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Authentication required" },
          { status: 401 }
        );
      }
      throw error;
    }

    const data = await request.json();
    const script = data.script as string;
    const requestedType =
      typeof data.testType === "string" ? (data.testType as TestType) : undefined;

    if (!script) {
      return NextResponse.json(
        { error: "Script is required" },
        { status: 400 }
      );
    }

    try {
      const scriptIsK6 = isK6Script(script);
      const isPerformanceType = requestedType === "performance";

      if (scriptIsK6 && requestedType && !isPerformanceType) {
        return NextResponse.json(
          {
            valid: false,
            error:
              "Detected k6 performance script. Switch the test type to Performance before running this script.",
            errorType: "type",
            isValidationError: true,
          },
          { status: 400 }
        );
      }

      if (!scriptIsK6 && isPerformanceType) {
        return NextResponse.json(
          {
            valid: false,
            error:
              "Performance tests require k6 scripts. Provide a k6 script or choose a Playwright-based test type.",
            errorType: "type",
            isValidationError: true,
          },
          { status: 400 }
        );
      }

      if (scriptIsK6) {
        const validation = validateK6Script(script, {
          selectedTestType: requestedType,
        });

        if (!validation.valid) {
          return NextResponse.json(
            {
              valid: false,
              error: validation.errors.join(", "),
              warnings: validation.warnings,
              errorType: "type",
              isValidationError: true,
            },
            { status: 400 }
          );
        }

        return NextResponse.json({
          valid: true,
          message: "k6 script validation passed",
          warnings: validation.warnings,
        });
      }

      const validationResult = playwrightValidationService.validateCode(script, {
        selectedTestType: requestedType,
      });

      if (!validationResult.valid) {
        return NextResponse.json(
          {
            valid: false,
            error: validationResult.error,
            line: validationResult.line,
            column: validationResult.column,
            errorType: validationResult.errorType,
            isValidationError: true,
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        valid: true,
        message: "Script validation passed",
      });
    } catch (error) {
      // Handle any unexpected errors during validation
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      console.error("Validation service error:", errorMessage);
      
      return NextResponse.json({
        valid: false,
        error: `Validation service error: ${errorMessage}`,
        errorType: 'service',
        isValidationError: true,
      }, { status: 500 });
    }
  } catch (error) {
    console.error("Error processing validation request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
} 
