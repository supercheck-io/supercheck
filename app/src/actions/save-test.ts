"use server";

declare const Buffer: {
  from(data: string, encoding: string): { toString(encoding: string): string };
};

import { eq } from "drizzle-orm";
import {
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
import { hasPermission } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { updateCoverageSnapshot } from "@/actions/requirements";

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

    // Ensure script is properly base64 encoded
    let scriptToSave = validatedData.script || "";

    // Check if the script is already base64 encoded
    // This is a more robust check for base64 format
    const isBase64 = (str: string): boolean => {
      try {
        // Check if the string matches base64 pattern
        const base64Regex = /^[A-Za-z0-9+/=]+$/;
        if (!base64Regex.test(str)) return false;

        // Try to decode it
        if (typeof window === "undefined") {
          const decoded = Buffer.from(str, "base64").toString("utf-8");
          // Re-encode it and check if it matches the original
          const reEncoded = Buffer.from(decoded, "utf-8").toString("base64");
          // If re-encoding gives the same result, it's likely base64
          // Note: This is not 100% accurate due to padding differences
          return str.length === reEncoded.length;
        }
        return false;
      } catch {
        return false;
      }
    };

    // Only encode if it's not already base64
    if (!isBase64(scriptToSave) && typeof window === "undefined") {
      scriptToSave = Buffer.from(scriptToSave, "utf-8").toString("base64");
    }

    // Check if this is an update (has an ID) or a new test
    if (validatedData.id) {
      // This is an update - check EDIT_TESTS permission
      const canEditTests = await hasPermission("test", "update", {
        organizationId,
        projectId: project.id,
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
       
      const { id: _, ...updateData } = validatedData;

      // Update the test in the database
      await db
        .update(tests)
        .set({
          ...updateData,
          script: scriptToSave,
          updatedAt: new Date(),
          priority: updateData.priority as TestPriority,
          type: updateData.type as TestType,
          organizationId: organizationId,
          projectId: project.id,
        })
        .where(eq(tests.id, testId));

      // Log the audit event for test update
      await logAuditEvent({
        userId,
        action: "test_updated",
        resource: "test",
        resourceId: testId,
        metadata: {
          organizationId,
          testTitle: validatedData.title,
          testType: validatedData.type,
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
      // This is a new test - check CREATE_TESTS permission
      const canCreateTests = await hasPermission("test", "create", {
        organizationId,
        projectId: project.id,
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

      // Insert the test into the database
      await db.insert(tests).values({
        id: newTestId,
        title: validatedData.title,
        description: validatedData.description,
        script: scriptToSave,
        priority: validatedData.priority as TestPriority,
        type: validatedData.type as TestType,
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
          testType: validatedData.type,
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
  // If the input is empty or not a string, return as is
  if (!base64Script || typeof base64Script !== "string") {
    return base64Script;
  }

  // Check if the string looks like base64
  const isBase64 = (str: string): boolean => {
    // Check if the string matches base64 pattern
    const base64Regex = /^[A-Za-z0-9+/=]+$/;
    return base64Regex.test(str);
  };

  // Only try to decode if it looks like base64
  if (isBase64(base64Script)) {
    try {
      // For client-side usage
      if (typeof window !== "undefined") {
        return decodeURIComponent(escape(atob(base64Script)));
      }
      // For server-side usage
      else {
        return Buffer.from(base64Script, "base64").toString("utf-8");
      }
    } catch (error) {
      console.error("Error decoding script:", error);
    }
  }

  // Return the original script if it's not base64 or if decoding fails
  return base64Script;
}
