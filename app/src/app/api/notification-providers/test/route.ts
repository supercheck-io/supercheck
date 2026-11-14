import { NextRequest, NextResponse } from "next/server";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError, authErrorStatus } from "@/lib/auth-context";
import { apiKeyRateLimiter, createRateLimitHeaders } from "@/lib/api-key-rate-limiter";
import {
  TEST_OTHER_RATE_LIMIT,
  testDiscordConnection,
  testEmailConnection,
  testSlackConnection,
  testTeamsConnection,
  testTelegramConnection,
  testWebhookConnection,
} from "@/lib/notification-providers/connection-test";

export async function POST(req: NextRequest) {
  try {
    // Require authentication and project context
    const context = await requireAuthContext();

    // PERFORMANCE: Use checkPermissionWithContext to avoid duplicate DB queries
    const canCreate = checkPermissionWithContext("notification", "create", context);

    if (!canCreate) {
      return NextResponse.json(
        {
          success: false,
          error: "Insufficient permissions to test connections",
        },
        { status: 403 }
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { type, config } = (rawBody ?? {}) as Record<string, any>;
    // A missing or non-object config would otherwise surface as a raw TypeError from a provider tester.
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return NextResponse.json(
        { success: false, error: "config must be an object" },
        { status: 400 }
      );
    }

    // Validate provider type
    const validTypes = ["email", "slack", "webhook", "telegram", "discord", "teams"];
    if (!type || !validTypes.includes(type)) {
      return NextResponse.json(
        { success: false, error: "Unsupported or missing provider type" },
        { status: 400 }
      );
    }

    // Email has its own tighter limit (after recipient checks); cap every other outbound test here.
    if (type !== "email") {
      const limit = await apiKeyRateLimiter.checkAndIncrement(`notification-test-other:${context.userId}`, TEST_OTHER_RATE_LIMIT);
      if (!limit.allowed) {
        return NextResponse.json(
          { success: false, error: "Too many connection tests. Try again later." },
          { status: limit.unavailable ? 503 : 429, headers: createRateLimitHeaders(limit) },
        );
      }
    }

    switch (type) {
      case "email":
        return await testEmailConnection(config, context);
      case "slack":
        return await testSlackConnection(config);
      case "webhook":
        return await testWebhookConnection(config);
      case "telegram":
        return await testTelegramConnection(config);
      case "discord":
        return await testDiscordConnection(config);
      case "teams":
        return await testTeamsConnection(config);
      default:
        return NextResponse.json(
          { success: false, error: "Unsupported provider type" },
          { status: 400 }
        );
    }
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : "Authentication required" },
        { status: authErrorStatus(error) }
      );
    }
    console.error("Error testing connection:", error);
    return NextResponse.json(
      { success: false, error: "Failed to test connection" },
      { status: 500 }
    );
  }
}

