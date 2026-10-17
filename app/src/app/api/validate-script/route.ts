import { NextRequest, NextResponse } from "next/server";
import { MAX_SCRIPT_LENGTH } from "@/lib/validations/common";
import {
  normalizeTestType,
  validateTestScript,
} from "@/lib/script-type-validator";
import { isK6Script } from "@/lib/k6-validator";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require authentication to prevent abuse (DoS via expensive validation)
    try {
      await requireAuthContext();
    } catch (error) {
      if (isAuthError(error)) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Authentication required",
          },
          { status: 401 },
        );
      }
      throw error;
    }

    let data: unknown;
    try {
      data = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      !("script" in data) ||
      typeof data.script !== "string"
    ) {
      return NextResponse.json(
        { error: "Script must be a string" },
        { status: 400 },
      );
    }
    const script = data.script;
    const requestedType =
      "testType" in data && typeof data.testType === "string"
        ? normalizeTestType(data.testType)
        : undefined;

    if (typeof script === "string" && script.length > MAX_SCRIPT_LENGTH) {
      return NextResponse.json(
        { error: `Script cannot exceed ${MAX_SCRIPT_LENGTH} characters` },
        { status: 413 },
      );
    }

    if (!script.trim()) {
      return NextResponse.json(
        { error: "Script is required" },
        { status: 400 },
      );
    }

    try {
      const validation = validateTestScript(script, requestedType);
      if (!validation.valid) {
        return NextResponse.json(
          {
            valid: false,
            error: validation.error,
            line: validation.line,
            column: validation.column,
            warnings: validation.warnings,
            errorType: validation.errorType,
            isValidationError: true,
          },
          { status: 400 },
        );
      }
      return NextResponse.json({
        valid: true,
        message: isK6Script(script)
          ? "k6 script validation passed"
          : "Script validation passed",
        warnings: validation.warnings,
      });
    } catch (error) {
      // Handle any unexpected errors during validation
      const errorMessage =
        error instanceof Error ? error.message : "Unknown validation error";
      console.error("Validation service error:", errorMessage);

      return NextResponse.json(
        {
          valid: false,
          error: `Validation service error: ${errorMessage}`,
          errorType: "service",
          isValidationError: true,
        },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Error processing validation request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
