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
import { updateCoverageSnapshot } from "@/lib/requirements-internal";
import { MAX_SCRIPT_LENGTH, MAX_DESCRIPTION_LENGTH } from "@/lib/validations/common";
import { subscriptionService, SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";
import {
  validateTestScript,
  validateScriptTypeMatch,
  normalizeTestType,
} from "@/lib/script-type-validator";
import {
  decodeStoredTestScript,
  encodeStoredTestScript,
} from "@/lib/test-script";

// Create a schema for the save test action
const saveTestSchema = testsInsertSchema.omit({
  createdAt: true,
  updatedAt: true,
});

// Add an optional id field for updates
const saveTestWithIdSchema = saveTestSchema.extend({
  id: z.string().uuid().optional(),
  requirementId: z.string().uuid().optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).nullish(),
});

export type SaveTestInput = z.infer<typeof saveTestWithIdSchema>;

/**
 * Server action to save a test to the database
 * @param data The test data to save
 * @returns The saved test ID
 */
export async function saveTest(
  data: SaveTestInput,
): Promise<{ id: string; success: boolean; error?: string }> {
  try {
    // Get user and project context
    const { userId, project, organizationId } = await requireProjectContext();

    const validatedData = saveTestWithIdSchema.parse(data);

    // Authorize before any lookup or script validation work.
    const permissionContext = { userId, organizationId, project };
    if (validatedData.id) {
      if (!checkPermissionWithContext("test", "update", permissionContext)) {
        console.warn(
          `User ${userId} attempted to update test ${validatedData.id} without EDIT_TESTS permission`,
        );
        return {
          id: "",
          success: false,
          error: "Insufficient permissions to edit tests",
        };
      }
    } else if (
      !checkPermissionWithContext("test", "create", permissionContext)
    ) {
      console.warn(
        `User ${userId} attempted to create test without CREATE_TESTS permission`,
      );
      return {
        id: "",
        success: false,
        error: "Insufficient permissions to create tests",
      };
    }

    await subscriptionService.blockUntilSubscribed(organizationId);
    await subscriptionService.requireValidPolarCustomer(organizationId);

    const existingTests = validatedData.id
      ? await db
          .select({ script: tests.script, type: tests.type })
          .from(tests)
          .where(
            and(
              eq(tests.id, validatedData.id),
              eq(tests.organizationId, organizationId),
              eq(tests.projectId, project.id),
            ),
          )
          .limit(1)
      : [];
    const existingTest = existingTests[0];
    if (validatedData.id && !existingTest) {
      return {
        id: "",
        success: false,
        error: "Test not found or access denied",
      };
    }
    const resolvedType =
      validatedData.type !== undefined
        ? normalizeTestType(validatedData.type)
        : (existingTest?.type ?? "browser");
    const hasSubmittedScript = validatedData.script !== undefined;
    const scriptToSave = hasSubmittedScript
      ? encodeStoredTestScript(validatedData.script!)
      : (existingTest?.script ?? "");
    if (hasSubmittedScript) {
      const script = decodeStoredTestScript(validatedData.script!);
      if (script.length > MAX_SCRIPT_LENGTH) {
        return {
          id: "",
          success: false,
          error: `Script cannot exceed ${MAX_SCRIPT_LENGTH} characters`,
        };
      }
      const validation = validateTestScript(script, resolvedType);
      if (!validation.valid)
        return { id: "", success: false, error: validation.error };
    } else if (existingTest && resolvedType !== existingTest.type) {
      // Metadata edits preserve legacy source; only a changed type needs rechecking.
      const validation = validateScriptTypeMatch(
        decodeStoredTestScript(existingTest.script),
        resolvedType,
      );
      if (!validation.valid)
        return { id: "", success: false, error: validation.error };
    }

    // Check if this is an update (has an ID) or a new test
    if (validatedData.id) {
      const testId = validatedData.id;

      // Update the test in the database; explicit fields only, so client input
      // cannot overwrite ownership columns such as createdByUserId.
      const updatedTests = await db
        .update(tests)
        .set({
          title: validatedData.title,
          description: validatedData.description,
          script: scriptToSave,
          updatedAt: new Date(),
          priority: validatedData.priority as TestPriority,
          type: resolvedType as TestType,
        })
        .where(
          and(
            eq(tests.id, testId),
            eq(tests.organizationId, organizationId),
            eq(tests.projectId, project.id),
          ),
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
      const newTestId = crypto.randomUUID();

      if (validatedData.requirementId) {
        const requirementRecord = await db
          .select({ id: requirements.id })
          .from(requirements)
          .where(
            and(
              eq(requirements.id, validatedData.requirementId),
              eq(requirements.organizationId, organizationId),
              eq(requirements.projectId, project.id),
            ),
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
    if (error instanceof SubscriptionAccessDeniedError) {
      return { id: "", success: false, error: error.message };
    }
    console.error("Error saving test:", error);
    return {
      id: "",
      success: false,
      // Never echo driver/SQL error text to the client.
      error:
        error instanceof z.ZodError
          ? "Invalid test data"
          : "Failed to save test",
    };
  }
}

/**
 * Helper function to decode a base64-encoded script.
 * Kept as an action because the playground form calls it from the browser, where
 * Node's Buffer is not guaranteed. It is a pure decode with no data access.
 * @param base64Script The base64-encoded script to decode
 * @returns The decoded script
 */
export async function decodeTestScript(base64Script: string): Promise<string> {
  return decodeStoredTestScript(base64Script);
}
