import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { tests, testTags, tags } from "@/db/schema";
import { desc, eq, and, inArray } from "drizzle-orm";
import { hasPermission } from "@/lib/rbac/middleware";
import { requireProjectContext } from "@/lib/project-context";
import { subscriptionService } from "@/lib/services/subscription-service";

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

export async function GET() {
  try {
    const { project, organizationId } = await requireProjectContext();

    // Use current project context - no need for query params or fallbacks
    const targetProjectId = project.id;

    // Check permission to view tests
    const canView = await hasPermission("test", "view", {
      organizationId,
      projectId: targetProjectId,
    });

    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Fetch tests scoped to the project
    // Using ID ordering instead of createdAt since UUIDv7 is time-ordered (PostgreSQL 18+)
    const allTests = await db
      .select()
      .from(tests)
      .where(
        and(
          eq(tests.projectId, targetProjectId),
          eq(tests.organizationId, organizationId)
        )
      )
      .orderBy(desc(tests.id));

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
    const formattedTests = await Promise.all(
      allTests.map(async (test) => {
        // Decode the script if it exists
        const decodedScript = test.script
          ? await decodeTestScript(test.script)
          : "";

        return {
          id: test.id,
          title: test.title,
          description: test.description,
          priority: test.priority,
          type: test.type,
          script: decodedScript, // Include the decoded script
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
        total: formattedTests.length,
        page: 1,
        limit: formattedTests.length,
        totalPages: 1,
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
    const { userId, project, organizationId } = await requireProjectContext();

    // SECURITY: Validate subscription before allowing test creation
    await subscriptionService.blockUntilSubscribed(organizationId);
    await subscriptionService.requireValidPolarCustomer(organizationId);

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
    const targetProjectId = project.id;

    // Check permission to create tests
    const canCreate = await hasPermission("test", "create", {
      organizationId,
      projectId: targetProjectId,
    });

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
        organizationId: organizationId,
        createdByUserId: userId,
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
