import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { tests } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { requireAuthContext, isAuthError } from '@/lib/auth-context';

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

export async function GET(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
) {
  const params = await routeContext.params;
  const testId = params.id;

  try {
    const context = await requireAuthContext();

    // Check permission to view tests
    const canView = checkPermissionWithContext('test', 'view', context);
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    
    // Find the test scoped to current project
    const result = await db
      .select()
      .from(tests)
      .where(
        and(
          eq(tests.id, testId),
          eq(tests.projectId, context.project.id),
          eq(tests.organizationId, context.organizationId)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Test not found" },
        { status: 404 }
      );
    }

    const test = result[0];

    // Decode the base64 script before returning
    const decodedScript = await decodeTestScript(test.script || "");

    // Return the test data
    return NextResponse.json({
      id: test.id,
      title: test.title,
      description: test.description,
      script: decodedScript, // Return the decoded script
      priority: test.priority,
      type: test.type,
      updatedAt: test.updatedAt,
      createdAt: test.createdAt,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error fetching test:", error);
    return NextResponse.json(
      { error: "Failed to fetch test" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
) {
  const params = await routeContext.params;
  const testId = params.id;

  try {
    const context = await requireAuthContext();
    const body = await request.json();

    // Find test scoped to current project
    const existingTest = await db.query.tests.findFirst({
      where: and(
        eq(tests.id, testId),
        eq(tests.projectId, context.project.id),
        eq(tests.organizationId, context.organizationId)
      ),
    });

    if (!existingTest) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }

    // Check permissions
    const canUpdate = checkPermissionWithContext("test", "update", context);

    if (!canUpdate) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Update the test
    const [updatedTest] = await db
      .update(tests)
      .set({
        title: body.title !== undefined ? body.title : existingTest.title,
        description: body.description !== undefined ? body.description : existingTest.description,
        script: body.script !== undefined ? body.script : existingTest.script,
        priority: body.priority !== undefined ? body.priority : existingTest.priority,
        type: body.type !== undefined ? body.type : existingTest.type,
        updatedAt: new Date(),
      })
      .where(eq(tests.id, testId))
      .returning();

    return NextResponse.json(updatedTest);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error(`Error updating test ${testId}:`, error);
    return NextResponse.json(
      { error: "Failed to update test" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
) {
  // NOTE: This API intentionally deviates from strict REST semantics.
  // PATCH is the canonical endpoint for partial updates and internally reuses
  // the same handler as PUT, which also behaves as a partial update for
  // backward-compatibility with older clients. New consumers should prefer PATCH.
  return PUT(request, routeContext);
}
