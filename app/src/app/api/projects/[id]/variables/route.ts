import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { projectVariables, projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { hasPermission } from "@/lib/rbac/middleware";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { createVariableSchema } from "@/lib/validations/variable";
import { encryptValue } from "@/lib/encryption";
import { z } from "zod";

export async function GET(request: NextRequest) {
  try {
    await requireUserAuthContext();
    const url = new URL(request.url);
    const projectId =
      url.pathname.split("/projects/")[1]?.split("/")[0] || "";

    // Verify project exists
    const project = await db
      .select({ id: projects.id, organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project.length) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    const organizationId = project[0].organizationId;

    const [canView, canCreate, canDelete, canViewSecrets] = await Promise.all([
      hasPermission("variable", "view", {
        organizationId,
        projectId,
      }),
      hasPermission("variable", "create", {
        organizationId,
        projectId,
      }),
      hasPermission("variable", "delete", {
        organizationId,
        projectId,
      }),
      hasPermission("variable", "view_secrets", {
        organizationId,
        projectId,
      }),
    ]);

    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions to view variables" },
        { status: 403 }
      );
    }

    // Fetch variables
    // Using ID ordering instead of createdAt since UUIDv7 is time-ordered (PostgreSQL 18+)
    const variables = await db
      .select()
      .from(projectVariables)
      .where(eq(projectVariables.projectId, projectId))
      .orderBy(projectVariables.id);

    // Process variables - never send secret values in list API
    const processedVariables = variables.map((variable) => {
      if (variable.isSecret) {
        return {
          ...variable,
          value: undefined,
          encryptedValue: undefined,
        };
      } else {
        return {
          ...variable,
          encryptedValue: undefined,
        };
      }
    });

    return NextResponse.json({
      success: true,
      data: processedVariables,
      // New names
      canCreate,
      canDelete,
      canViewSecrets,
      // Backward compatibility with old names
      canCreateEdit: canCreate,
      canManage: canDelete,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }

    console.error("Error fetching project variables:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split("/projects/")[1]?.split("/")[0] || "";

    const { userId } = await requireUserAuthContext();

    // Verify project exists and user has permission to create variables
    const project = await db
      .select({ id: projects.id, organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project.length) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    const canCreate = await hasPermission("variable", "create", {
      organizationId: project[0].organizationId,
      projectId,
    });
    if (!canCreate) {
      return NextResponse.json(
        { error: "Insufficient permissions to create variables" },
        { status: 403 }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error("Invalid JSON in request body:", parseError);
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    try {
      const validatedData = createVariableSchema.parse(body);

      // Check if variable key already exists for this project
      const existingVariable = await db
        .select()
        .from(projectVariables)
        .where(
          and(
            eq(projectVariables.projectId, projectId),
            eq(projectVariables.key, validatedData.key)
          )
        )
        .limit(1);

      if (existingVariable.length > 0) {
        return NextResponse.json(
          { error: "Variable with this name already exists" },
          { status: 400 }
        );
      }

      // Prepare variable data
      const variableData = {
        projectId,
        key: validatedData.key,
        isSecret: validatedData.isSecret,
        description: validatedData.description?.trim() || null,
        createdByUserId: userId,
        value: "",
        encryptedValue: null as string | null,
      };

      if (validatedData.isSecret) {
        // Encrypt the value and store in encryptedValue field
        const encrypted = encryptValue(validatedData.value, projectId);
        variableData.encryptedValue = encrypted;
        variableData.value = "[ENCRYPTED]"; // Placeholder
      } else {
        variableData.value = validatedData.value;
        variableData.encryptedValue = null;
      }

      // Insert the variable
      const [newVariable] = await db
        .insert(projectVariables)
        .values(variableData)
        .returning();

      // Return the variable (without encrypted data)
      const responseVariable = {
        ...newVariable,
        encryptedValue: undefined,
        value: validatedData.isSecret ? "[ENCRYPTED]" : newVariable.value,
      };

      return NextResponse.json({
        success: true,
        data: responseVariable,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Validation error", details: error.errors },
          { status: 400 }
        );
      }

      console.error("Error creating project variable:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }

    console.error("Error creating project variable:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
