import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { projectVariables, projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  hasPermission,
  withRateLimit,
} from "@/lib/rbac/middleware";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { decryptValue } from "@/lib/encryption";
import { logAuditEvent } from "@/lib/audit-logger";

// Rate limit secret decryption attempts (10 per minute per IP)
const rateLimitedHandler = withRateLimit(10, 60 * 1000, {
  auditAction: "secret_decrypt_rate_limit_exceeded",
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; variableId: string }> }
) {
  return rateLimitedHandler(request, async (req, { userId }) => {
    let projectId: string | undefined;
    let variableId: string | undefined;
    let project: { id: string; organizationId: string }[] = [];

    try {
      const { userId: authUserId } = await requireUserAuthContext();
      const resolvedParams = await params;
      projectId = resolvedParams.id;
      variableId = resolvedParams.variableId;

      // Get project info for organization ID
      project = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project.length) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }

      // Check if user has permission to view secret variables using centralized function
      const canViewSecrets = await hasPermission("variable", "view_secrets", {
        organizationId: project[0].organizationId,
        projectId,
      });

      if (!canViewSecrets) {
        await logAuditEvent({
          userId: authUserId,
          action: "secret_decrypt_unauthorized",
          resource: "project_variable",
          resourceId: variableId,
          metadata: {
            projectId,
            reason: "insufficient_permissions",
          },
          success: false,
        });

        return NextResponse.json(
          {
            error: "Forbidden: Insufficient permissions to view secret values",
          },
          { status: 403 }
        );
      }

      // Check if variable exists and belongs to the project
      const [existingVariable] = await db
        .select()
        .from(projectVariables)
        .where(
          and(
            eq(projectVariables.id, variableId),
            eq(projectVariables.projectId, projectId)
          )
        );

      if (!existingVariable) {
        return NextResponse.json(
          { error: "Variable not found" },
          { status: 404 }
        );
      }

      // Ensure the variable is actually a secret
      if (!existingVariable.isSecret) {
        await logAuditEvent({
          userId: authUserId,
          action: "secret_decrypt_non_secret",
          resource: "project_variable",
          resourceId: variableId,
          metadata: {
            projectId,
            organizationId: project[0].organizationId,
            variableKey: existingVariable.key,
            reason: "variable_not_secret",
          },
          success: false,
        });

        return NextResponse.json(
          {
            error: "Variable is not a secret",
          },
          { status: 400 }
        );
      }

      // Check if encrypted value exists
      if (!existingVariable.encryptedValue) {
        await logAuditEvent({
          userId: authUserId,
          action: "secret_decrypt_no_value",
          resource: "project_variable",
          resourceId: variableId,
          metadata: {
            projectId,
            organizationId: project[0].organizationId,
            variableKey: existingVariable.key,
            reason: "no_encrypted_value",
          },
          success: false,
        });

        return NextResponse.json(
          {
            error: "No encrypted value found for this secret",
          },
          { status: 400 }
        );
      }

      // Decrypt the secret value
      let decryptedValue: string;
      try {
        decryptedValue = decryptValue(
          existingVariable.encryptedValue,
          projectId
        );
      } catch (decryptError) {
        console.error("Failed to decrypt secret:", variableId, decryptError);

        await logAuditEvent({
          userId: authUserId,
          action: "secret_decrypt_failed",
          resource: "project_variable",
          resourceId: variableId,
          metadata: {
            projectId,
            organizationId: project[0].organizationId,
            variableKey: existingVariable.key,
            error: "decryption_failed",
          },
          success: false,
        });

        return NextResponse.json(
          {
            error: "Failed to decrypt secret value",
          },
          { status: 500 }
        );
      }

      // Log successful secret decryption
      await logAuditEvent({
        userId: authUserId,
        action: "secret_decrypt_success",
        resource: "project_variable",
        resourceId: variableId,
        metadata: {
          projectId,
          organizationId: project[0].organizationId,
          variableKey: existingVariable.key,
        },
        success: true,
      });

      // Return the decrypted value
      return NextResponse.json({
        success: true,
        data: {
          id: variableId,
          key: existingVariable.key,
          value: decryptedValue,
          description: existingVariable.description,
        },
      });
    } catch (error) {
      if (isAuthError(error)) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Authentication required" },
          { status: 401 }
        );
      }

      // Log error
      if (userId && projectId && variableId) {
        await logAuditEvent({
          userId,
          action: "secret_decrypt_error",
          resource: "project_variable",
          resourceId: variableId,
          metadata: {
            projectId,
            organizationId: project[0]?.organizationId,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          success: false,
        });
      }

      console.error("Error decrypting secret:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
