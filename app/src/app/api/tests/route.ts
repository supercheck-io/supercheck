import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { tests, testTags, tags } from "@/db/schema";
import { desc, eq, and, inArray, like, count } from "drizzle-orm";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireProjectContext } from "@/lib/project-context";
import { subscriptionService } from "@/lib/services/subscription-service";
import type { TestType } from "@/db/schema/types";

declare const Buffer: {
  from(data: string, encoding: string): { toString(encoding: string): string };
};

/**
 * Helper function to decode base64-encoded test scripts
 * Works in both client and server environments
 */
async function decodeTestScript(base64Script: string): Promise<string> {
  // Check if the string is base64 encoded
  // A valid base64 string should only contain these characters
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  const isBase64 = base64Regex.test(base64Script);

  if (!isBase64) {
    // If it's not base64, return as is
    return base64Script;
  }

  try {
    // In Node.js environment (server-side)
    if (typeof window === "undefined") {
      const decoded = Buffer.from(base64Script, "base64").toString("utf-8");
      return decoded;
    }
    // Fallback for browser environment
    return base64Script;
  } catch (error) {
    console.error("Error decoding base64:", error);
    // Return original if decoding fails
    return base64Script;
  }
}

/**
 * GET /api/tests
 *
 * Fetches tests with optional pagination and filtering.
 *
 * Query Parameters:
 * - includeScript: boolean (default: false) - Include decoded script content in response
 * - limit: number (default: 200, max: 1000) - Number of tests to return
 * - page: number (default: 1) - Page number for pagination
 * - search: string (optional) - Search filter for test title
 * - type: string (optional) - Filter by test type
 *
 * PERFORMANCE OPTIMIZATION:
 * By default, script content is excluded from the response to reduce payload size.
 * For 200 tests with scripts, this can reduce response size from several MB to ~50KB.
 * Use ?includeScript=true only when script content is needed (e.g., Playground).
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireProjectContext();

    // Use current project context - no need for query params or fallbacks
    const targetProjectId = context.project.id;

    // PERFORMANCE: Use checkPermissionWithContext to avoid 5-8 duplicate DB queries
    const canView = checkPermissionWithContext("test", "view", context);

    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Parse query parameters for pagination and filtering
    const { searchParams } = new URL(request.url);
    const includeScript = searchParams.get("includeScript") === "true";
    const limitParam = parseInt(searchParams.get("limit") || "200", 10);
    const pageParam = parseInt(searchParams.get("page") || "1", 10);
    const searchQuery = searchParams.get("search") || "";
    const typeFilter = searchParams.get("type") || "";

    // Validate and constrain pagination params
    const limit = Math.min(Math.max(1, limitParam), 1000); // 1-1000
    const page = Math.max(1, pageParam);
    const offset = (page - 1) * limit;

    // Build where conditions
    const whereConditions = [
      eq(tests.projectId, targetProjectId),
      eq(tests.organizationId, context.organizationId),
    ];

    // Add search filter if provided (search by title)
    if (searchQuery.trim()) {
      whereConditions.push(like(tests.title, `%${searchQuery.trim()}%`));
    }

    // Add type filter if provided
    if (typeFilter.trim()) {
      // Cast to TestType - the API will just return empty results for invalid types
      whereConditions.push(eq(tests.type, typeFilter.trim() as TestType));
    }

    // Get total count for pagination (parallel with main query)
    const [countResult, allTests] = await Promise.all([
      db
        .select({ count: count() })
        .from(tests)
        .where(and(...whereConditions)),
      db
        .select()
        .from(tests)
        .where(and(...whereConditions))
        .orderBy(desc(tests.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const totalCount = countResult[0]?.count || 0;
    const totalPages = Math.ceil(totalCount / limit);

    // Get tags for tests in this project only
    const testIds = allTests.map((test) => test.id);
    const allTestTags =
      testIds.length > 0
        ? await db
            .select({
              testId: testTags.testId,
              tagId: tags.id,
              tagName: tags.name,
              tagColor: tags.color,
            })
            .from(testTags)
            .innerJoin(tags, eq(testTags.tagId, tags.id))
            .where(inArray(testTags.testId, testIds))
        : [];

    // Group tags by test ID
    const testTagsMap = new Map<
      string,
      Array<{ id: string; name: string; color: string | null }>
    >();
    allTestTags.forEach(({ testId, tagId, tagName, tagColor }) => {
      if (!testTagsMap.has(testId)) {
        testTagsMap.set(testId, []);
      }
      testTagsMap.get(testId)!.push({
        id: tagId,
        name: tagName,
        color: tagColor,
      });
    });

    // Map the database results to the expected format
    // PERFORMANCE OPTIMIZATION: Only decode scripts when explicitly requested
    // This significantly reduces payload size for list views (KB vs MB)
    const formattedTests = await Promise.all(
      allTests.map(async (test) => {
        // Only decode and include script if explicitly requested
        const script =
          includeScript && test.script
            ? await decodeTestScript(test.script)
            : undefined;

        return {
          id: test.id,
          name: test.title, // Frontend expects 'name', map from 'title' for compatibility
          title: test.title,
          description: test.description,
          priority: test.priority,
          type: test.type,
          // Only include script field when requested (reduces payload significantly)
          ...(includeScript && { script }),
          tags: testTagsMap.get(test.id) || [], // Include tags
          createdAt: test.createdAt
            ? new Date(test.createdAt).toISOString()
            : null,
          updatedAt: test.updatedAt
            ? new Date(test.updatedAt).toISOString()
            : null,
        };
      })
    );

    // Return standardized response format for React Query hooks
    return NextResponse.json({
      data: formattedTests,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching tests:", error);

    // Return more detailed error information in development
    const isDevelopment = process.env.NODE_ENV === "development";

    return NextResponse.json(
      {
        error: "Failed to fetch tests",
        details: isDevelopment ? (error as Error).message : undefined,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireProjectContext();

    // SECURITY: Validate subscription before allowing test creation
    await subscriptionService.blockUntilSubscribed(context.organizationId);
    await subscriptionService.requireValidPolarCustomer(context.organizationId);

    const body = await request.json();
    const { title, description, priority, type, script } = body;

    // Validate required fields
    if (!title) {
      return NextResponse.json(
        { error: "Test title is required" },
        { status: 400 }
      );
    }

    // Use current project context
    const targetProjectId = context.project.id;

    // PERFORMANCE: Use checkPermissionWithContext to avoid duplicate DB queries
    const canCreate = checkPermissionWithContext("test", "create", context);

    if (!canCreate) {
      return NextResponse.json(
        { error: "Insufficient permissions to create tests" },
        { status: 403 }
      );
    }

    // Create the test
    const [newTest] = await db
      .insert(tests)
      .values({
        title,
        description: description || null,
        priority: priority || "medium",
        type: type || "e2e",
        script: script || null,
        projectId: targetProjectId,
        organizationId: context.organizationId,
        createdByUserId: context.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json(
      {
        success: true,
        test: {
          id: newTest.id,
          title: newTest.title,
          description: newTest.description,
          priority: newTest.priority,
          type: newTest.type,
          script: newTest.script,
          projectId: newTest.projectId,
          organizationId: newTest.organizationId,
          createdAt: newTest.createdAt ? newTest.createdAt.toISOString() : null,
          updatedAt: newTest.updatedAt ? newTest.updatedAt.toISOString() : null,
          tags: [],
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating test:", error);

    const isDevelopment = process.env.NODE_ENV === "development";

    return NextResponse.json(
      {
        error: "Failed to create test",
        details: isDevelopment ? (error as Error).message : undefined,
      },
      { status: 500 }
    );
  }
}
