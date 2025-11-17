import { NextRequest, NextResponse } from "next/server";
import { AIStreamingService } from "@/lib/ai-streaming-service";
import { AISecurityService, AuthService } from "@/lib/ai-security";
import { AIPromptBuilder } from "@/lib/ai-prompts";

export async function POST(request: NextRequest) {
  try {
    // Step 1: Input validation and sanitization
    const body = await request.json();

    // Validate required fields
    if (!body.userRequest || typeof body.userRequest !== "string") {
      return NextResponse.json(
        {
          success: false,
          reason: "invalid_request",
          message: "User request is required",
        },
        { status: 400 }
      );
    }

    if (!body.testType || typeof body.testType !== "string") {
      return NextResponse.json(
        {
          success: false,
          reason: "invalid_request",
          message: "Test type is required",
        },
        { status: 400 }
      );
    }

    const userRequest = body.userRequest.trim();
    const testType = body.testType;
    const currentScript = body.currentScript ? body.currentScript.trim() : "";

    // Validate user request length
    if (userRequest.length < 10) {
      return NextResponse.json(
        {
          success: false,
          reason: "invalid_request",
          message: "Please provide a more detailed description (at least 10 characters)",
        },
        { status: 400 }
      );
    }

    if (userRequest.length > 2000) {
      return NextResponse.json(
        {
          success: false,
          reason: "invalid_request",
          message: "Description is too long (maximum 2000 characters)",
        },
        { status: 400 }
      );
    }

    // Sanitize inputs
    const sanitizedUserRequest = AISecurityService.sanitizeTextOutput(userRequest);
    const sanitizedCurrentScript = currentScript
      ? AISecurityService.sanitizeCodeOutput(currentScript)
      : "";

    // Step 2: Authentication and authorization
    await AuthService.checkRateLimit();

    // Step 3: Build AI create prompt
    const prompt = AIPromptBuilder.buildCreatePrompt({
      currentScript: sanitizedCurrentScript,
      testType,
      userRequest: sanitizedUserRequest,
    });

    // Step 4: Generate streaming AI response
    const aiResponse = await AIStreamingService.generateStreamingResponse({
      prompt,
      maxTokens: 4000,
      temperature: 0.2, // Slightly higher temperature for creative code generation
      testType,
    });

    // Step 5: Return streaming response with appropriate headers
    return new NextResponse(aiResponse.stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-AI-Model": aiResponse.model,
        "X-Operation": "create",
      },
    });
  } catch (error) {
    console.error("AI create streaming failed:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const isAuthError =
      errorMessage.includes("Authentication") ||
      errorMessage.includes("Unauthorized");
    const isRateLimitError =
      errorMessage.includes("rate limit") ||
      errorMessage.includes("too many requests");
    const isSecurityError =
      errorMessage.includes("unsafe") || errorMessage.includes("security");

    if (isAuthError) {
      return NextResponse.json(
        {
          success: false,
          reason: "authentication_required",
          message: "Authentication required to use AI create feature",
          guidance: "Please log in and try again",
        },
        { status: 401 }
      );
    }

    if (isRateLimitError) {
      return NextResponse.json(
        {
          success: false,
          reason: "rate_limited",
          message: "Too many AI create requests. Please wait before trying again.",
          guidance:
            "Rate limiting helps ensure fair usage and service availability",
        },
        { status: 429 }
      );
    }

    if (isSecurityError) {
      return NextResponse.json(
        {
          success: false,
          reason: "security_violation",
          message: "Request blocked for security reasons",
          guidance:
            "Please ensure your request follows security guidelines",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        reason: "generation_failed",
        message: "Failed to generate test code. Please try again.",
        guidance: "If the problem persists, try simplifying your request.",
      },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  try {
    const healthStatus = await AIStreamingService.healthCheck();

    return NextResponse.json({
      status: healthStatus.status,
      timestamp: new Date().toISOString(),
      service: "ai-create-api",
      details: healthStatus.details,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        service: "ai-create-api",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
