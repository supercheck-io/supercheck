import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { tests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, hasPermission } from '@/lib/rbac/middleware';

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
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const testId = params.id;

  try {
    await requireAuth();
    
    // First, find the test without filtering by active project
    const result = await db
      .select()
      .from(tests)
      .where(eq(tests.id, testId))
      .limit(1);

    // If no test was found, return 404
    if (result.length === 0) {
      return NextResponse.json(
        { error: "Test not found" },
        { status: 404 }
      );
    }

    const test = result[0];
    
    // Now check if user has access to this test's project
    if (!test.organizationId || !test.projectId) {
      return NextResponse.json(
        { error: "Test data incomplete" },
        { status: 500 }
      );
    }
    
    const canView = await hasPermission('test', 'view', {
      organizationId: test.organizationId,
      projectId: test.projectId
    });
    
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

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
    console.error("Error fetching test:", error);
    return NextResponse.json(
      { error: "Failed to fetch test" },
      { status: 500 }
    );
  }
}
