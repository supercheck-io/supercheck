"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { randomUUID } from "crypto";

const createStatusPageSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  headline: z.string().max(255).optional(),
  pageDescription: z.string().optional(),
});

export type CreateStatusPageData = z.infer<typeof createStatusPageSchema>;

export async function createStatusPage(data: CreateStatusPageData) {
  console.log(`Creating status page with data:`, JSON.stringify(data, null, 2));

  try {
    // Get current project context (includes auth verification)
    const { userId, project, organizationId } = await requireProjectContext();

    // Check status page creation permission using Better Auth
    try {
      await requirePermissions(
        {
          status_page: ["create"],
        },
        {
          organizationId,
          projectId: project.id,
        }
      );
    } catch (error) {
      console.warn(
        `User ${userId} attempted to create status page without permission:`,
        error
      );
      return {
        success: false,
        message: "Insufficient permissions to create status pages",
      };
    }

    // Validate the data
    const validatedData = createStatusPageSchema.parse(data);

    // Generate a unique subdomain using UUID v4 without dashes
    const subdomain = randomUUID().replace(/-/g, "");

    try {
      // Create the status page with proper project and user association
      const [statusPage] = await db
        .insert(statusPages)
        .values({
          organizationId: organizationId,
          projectId: project.id,
          name: validatedData.name,
          subdomain: subdomain,
          headline: validatedData.headline || null,
          pageDescription: validatedData.pageDescription || null,
          status: "draft",
          createdByUserId: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      console.log(
        `Status page ${statusPage.id} created successfully by user ${userId} in project ${project.name}`
      );

      // Log the audit event
      await logAuditEvent({
        userId,
        action: "status_page_created",
        resource: "status_page",
        resourceId: statusPage.id,
        metadata: {
          organizationId,
          statusPageName: validatedData.name,
          projectId: project.id,
          projectName: project.name,
          subdomain: statusPage.subdomain,
        },
        success: true,
      });

      // Revalidate the status pages page
      revalidatePath("/status-pages");

      return {
        success: true,
        message: "Status page created successfully",
        statusPage: {
          id: statusPage.id,
          name: statusPage.name,
          headline: statusPage.headline,
          pageDescription: statusPage.pageDescription,
          subdomain: statusPage.subdomain,
          status: statusPage.status,
          createdAt: statusPage.createdAt,
          updatedAt: statusPage.updatedAt,
          createdByUserId: userId,
        },
      };
    } catch (dbError) {
      console.error("Database error:", dbError);
      return {
        success: false,
        message: `Failed to create status page: ${
          dbError instanceof Error ? dbError.message : String(dbError)
        }`,
        error: dbError,
      };
    }
  } catch (validationError) {
    console.error("Validation error:", validationError);
    return {
      success: false,
      message: "Invalid data provided",
      error: validationError,
    };
  }
}
