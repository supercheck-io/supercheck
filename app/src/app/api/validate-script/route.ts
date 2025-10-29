import { NextRequest, NextResponse } from "next/server";
import { validationService } from "@/lib/validation-service";

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const script = data.script as string;

    if (!script) {
      return NextResponse.json(
        { error: "Script is required" },
        { status: 400 }
      );
    }

    try {
      const validationResult = validationService.validateCode(script);
      
      if (!validationResult.valid) {
        return NextResponse.json({
          valid: false,
          error: validationResult.error,
          line: validationResult.line,
          column: validationResult.column,
          errorType: validationResult.errorType,
          isValidationError: true,
        }, { status: 400 });
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