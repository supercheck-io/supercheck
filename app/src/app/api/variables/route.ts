/**
 * GET/POST /api/variables
 *
 * CLI-friendly variable endpoints that use project context from auth token.
 * These mirror /api/projects/[id]/variables but resolve the project from
 * the authenticated session or Bearer token instead of requiring it in the URL.
 *
 * Multi-tenant scoping: The `projectVariables` table is scoped by `projectId` only
 * (no `organizationId` column). Organization-level isolation is enforced by
 * `requireAuthContext()`, which validates that the resolved project belongs to
 * the authenticated user's organization.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { projectVariables } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { encryptValue } from "@/lib/encryption";
import { createVariableSchema } from "@/lib/validations/variable";

export async function GET() {
  try {
    const context = await requireAuthContext();

    const canView = checkPermissionWithContext("variable", "view", context);
    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const variables = await db
      .select()
      .from(projectVariables)
      .where(eq(projectVariables.projectId, context.project.id))
      .orderBy(projectVariables.id);

    const processedVariables = variables.map((v) => ({
      ...v,
      value: v.isSecret ? undefined : v.value,
      encryptedValue: undefined,
    }));

    return NextResponse.json(processedVariables);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error fetching variables:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireAuthContext();

    const canCreate = checkPermissionWithContext("variable", "create", context);
    if (!canCreate) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const validation = createVariableSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input. Check variable fields and try again." },
        { status: 400 }
      );
    }

    const { key, value, isSecret, description } = validation.data;

    // Check for duplicate key
    const existing = await db
      .select({ id: projectVariables.id })
      .from(projectVariables)
      .where(
        and(
          eq(projectVariables.projectId, context.project.id),
          eq(projectVariables.key, key)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Variable with this key already exists" },
        { status: 409 }
      );
    }

    const variableData: Record<string, unknown> = {
      projectId: context.project.id,
      key,
      isSecret,
      type: isSecret ? "secret" : "variable",
      description: description || null,
      createdByUserId: context.userId,
      value: "",
      encryptedValue: null,
    };

    if (isSecret) {
      variableData.encryptedValue = encryptValue(value, context.project.id);
      variableData.value = "[ENCRYPTED]";
    } else {
      variableData.value = value;
    }

    const [newVariable] = await db
      .insert(projectVariables)
      .values(variableData as typeof projectVariables.$inferInsert)
      .returning();

    return NextResponse.json(
      {
        ...newVariable,
        value: isSecret ? "[ENCRYPTED]" : newVariable.value,
        encryptedValue: undefined,
      },
      { status: 201 }
    );
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error creating variable:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
