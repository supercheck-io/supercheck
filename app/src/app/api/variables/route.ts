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
import { z } from "zod";

const createVariableSchema = z.object({
  key: z
    .string()
    .min(1, "Key is required")
    .max(100, "Key must be less than 100 characters")
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Key must be a valid identifier"),
  value: z.string().min(1, "Value is required").max(10000, "Value must be less than 10000 characters"),
  isSecret: z.boolean().default(false),
  description: z.string().max(500).optional(),
});

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
        { error: "Validation error", details: validation.error.issues },
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
