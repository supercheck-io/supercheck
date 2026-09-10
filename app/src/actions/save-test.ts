"use server";

import { and, eq } from "drizzle-orm";
import {
  requirements,
  tests,
  testsInsertSchema,
  type TestPriority,
  type TestType,
  testRequirements,
} from "@/db/schema";
import { db } from "@/utils/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import crypto from "crypto";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { updateCoverageSnapshot } from "@/actions/requirements";
import { validateScriptTypeMatch, normalizeTestType } from "@/lib/script-type-validator";
import { decodeStoredTestScript, encodeStoredTestScript } from "@/lib/test-script";

// Create a schema for the save test action
const saveTestSchema = testsInsertSchema.omit({
  createdAt: true,
  updatedAt: true,
});

// Add an optional id field for updates
const saveTestWithIdSchema = saveTestSchema.extend({
  id: z.string().optional(),
  requirementId: z.string().optional(),
});

export type SaveTestInput = z.infer<typeof saveTestWithIdSchema>;

/**
 * Server action to save a test to the database
 * @param data The test data to save
 * @returns The saved test ID
 */
export async function saveTest(
  data: SaveTestInput
): Promise<{ id: string; success: boolean; error?: string }> {
  try {
    // Get user and project context
    const { userId, project, organizationId } = await requireProjectContext();

    const validatedData = saveTestWithIdSchema.parse(data);

    const scriptToSave = encodeStoredTestScript(validatedData.script || "");
    const scriptForValidation = decodeStoredTestScript(validatedData.script || "");

    const resolvedType = normalizeTestType(validatedData.type);
    if (scriptForValidation.trim().length > 0) {
      const typeValidation = validateScriptTypeMatch(scriptForValidation, resolvedType);
      if (!typeValidation.valid) {
        return {
          id: "",
          success: false,
          error: typeValidation.error,
        };
      }
    } else if (validatedData.id) {
      // When updating a test with no script provided, fetch the existing script
      // and validate it against the new type to prevent type mismatches
      const existingTest = await db
        .select({ script: tests.script, type: tests.type })
        .from(tests)
        .where(
          and(
            eq(tests.id, validatedData.id),
            eq(tests.organizationId, organizationId),
            eq(tests.projectId, project.id)
          )
        )
        .limit(1);

      if (existingTest.length > 0 && existingTest[0].script) {
        const existingScript = decodeStoredTestScript(existingTest[0].script);
        const typeValidation = validateScriptTypeMatch(existingScript, resolvedType);
        if (!typeValidation.valid) {
          return {
            id: "",
            success: false,
            error: typeValidation.error,
          };
        }
      }
    }

    // Check if this is an update (has an ID) or a new test
    if (validatedData.id) {
      // This is an update - check EDIT_TESTS permission (optimized - reuses context)
      const canEditTests = checkPermissionWithContext("test", "update", {
        userId,
        organizationId,
        project,
      });

      if (!canEditTests) {
        console.warn(
          `User ${userId} attempted to update test ${validatedData.id} without EDIT_TESTS permission`
        );
        return {
          id: "",
          success: false,
          error: "Insufficient permissions to edit tests",
        };
      }

      const testId = validatedData.id;

      // Remove the id from the data to update
       
      const { id: _, requirementId: _requirementId, ...updateData } = validatedData;

      // Update the test in the database
      const updatedTests = await db
        .update(tests)
        .set({
          ...updateData,
          script: scriptToSave,
          updatedAt: new Date(),
          priority: updateData.priority as TestPriority,
          type: resolvedType as TestType,
          organizationId: organizationId,
          projectId: project.id,
        })
        .where(
          and(
            eq(tests.id, testId),
            eq(tests.organizationId, organizationId),
            eq(tests.projectId, project.id)
          )
        )
        .returning({ id: tests.id });

      if (updatedTests.length === 0) {
        return {
          id: "",
          success: false,
          error: "Test not found or access denied",
        };
      }

      // Log the audit event for test update
      await logAuditEvent({
        userId,
        action: "test_updated",
        resource: "test",
        resourceId: testId,
        metadata: {
          organizationId,
          testTitle: validatedData.title,
          testType: resolvedType,
          testPriority: validatedData.priority,
          projectId: project.id,
          projectName: project.name,
        },
        success: true,
      });

      // Revalidate the tests page to show the updated data
      revalidatePath("/tests");

      // Return the updated test ID
      return { id: testId, success: true };
    } else {
      // This is a new test - check CREATE_TESTS permission (optimized - reuses context)
      const canCreateTests = checkPermissionWithContext("test", "create", {
        userId,
        organizationId,
        project,
      });

      if (!canCreateTests) {
        console.warn(
          `User ${userId} attempted to create test without CREATE_TESTS permission`
        );
        return {
          id: "",
          success: false,
          error: "Insufficient permissions to create tests",
        };
      }

      const newTestId = crypto.randomUUID();

      if (validatedData.requirementId) {
        const requirementRecord = await db
          .select({ id: requirements.id })
          .from(requirements)
          .where(
            and(
              eq(requirements.id, validatedData.requirementId),
              eq(requirements.organizationId, organizationId),
              eq(requirements.projectId, project.id)
            )
          )
          .limit(1);

        if (requirementRecord.length === 0) {
          return {
            id: "",
            success: false,
            error: "Requirement not found or access denied",
          };
        }
      }

      // Insert the test into the database
      await db.insert(tests).values({
        id: newTestId,
        title: validatedData.title,
        description: validatedData.description,
        script: scriptToSave,
        priority: validatedData.priority as TestPriority,
        type: resolvedType as TestType,
        organizationId: organizationId,
        projectId: project.id,
        createdByUserId: userId,
        createdAt: new Date(),
        // Don't set updatedAt on creation - it should remain null until first update
      });

      // If requirementId is provided, link the test to the requirement
      if (validatedData.requirementId) {
        await db.insert(testRequirements).values({
          testId: newTestId,
          requirementId: validatedData.requirementId,
        });
        // Update the coverage snapshot to reflect the new link
        await updateCoverageSnapshot(validatedData.requirementId);
      }

      // Log the audit event for test creation
      await logAuditEvent({
        userId,
        action: "test_created",
        resource: "test",
        resourceId: newTestId,
        metadata: {
          organizationId,
          testTitle: validatedData.title,
          testType: resolvedType,
          testPriority: validatedData.priority,
          projectId: project.id,
          projectName: project.name,
        },
        success: true,
      });

      // Revalidate the tests page to show the updated data
      revalidatePath("/tests");
      
      // If linked to a requirement, revalidate requirements page too
      if (validatedData.requirementId) {
        revalidatePath("/requirements");
      }

      // Return the inserted test ID
      return { id: newTestId, success: true };
    }
  } catch (error) {
    console.error("Error saving test:", error);
    return {
      id: "",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Helper function to decode a base64-encoded script
 * This should be used on the client side when loading a test from the database
 * @param base64Script The base64-encoded script to decode
 * @returns The decoded script
 */
export async function decodeTestScript(base64Script: string): Promise<string> {
  return decodeStoredTestScript(base64Script);
}
