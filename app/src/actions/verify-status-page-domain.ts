"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { revalidatePath } from "next/cache";
import { resolveCname } from "node:dns/promises";
import { z } from "zod";
import { logAuditEvent } from "@/lib/audit-logger";

// UUID validation schema
const uuidSchema = z.string().uuid("Invalid status page ID");

export async function verifyStatusPageDomain(statusPageId: string) {
  try {
    // Validate UUID format first
    const parseResult = uuidSchema.safeParse(statusPageId);
    if (!parseResult.success) {
      return {
        success: false,
        message: "Invalid status page ID format",
      };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    await requirePermissions(
      { status_page: ["update"] },
      { organizationId, projectId: project.id }
    );

    // SECURITY: Get status page with ownership verification
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.organizationId, organizationId),
        eq(statusPages.projectId, project.id)
      ),
    });

    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to verify domain for status page ${statusPageId} without ownership`
      );
      return {
        success: false,
        message: "Status page not found or access denied",
      };
    }

    if (!statusPage.customDomain) {
      return {
        success: false,
        message: "No custom domain configured",
      };
    }

    // Verify DNS
    try {
      const cnames = await resolveCname(statusPage.customDomain);

      // Get valid CNAME targets from environment
      // STATUS_PAGE_DOMAIN is the base domain for status pages
      // Self-hosted users should set this to their own domain
      const baseDomain = process.env.STATUS_PAGE_DOMAIN || "supercheck.io";

      // Accept the base domain and common CNAME subdomains
      const validTargets = [
        baseDomain, // e.g., "supercheck.io" or "yourdomain.com"
        `cname.${baseDomain}`, // e.g., "cname.supercheck.io"
        `ingress.${baseDomain}`, // e.g., "ingress.supercheck.io"
      ];
      const isValid = cnames.some((cname) =>
        validTargets.some((target) => cname.includes(target))
      );

      if (isValid) {
        // Update status page with ownership check
        await db
          .update(statusPages)
          .set({
            customDomainVerified: true,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(statusPages.id, statusPageId),
              eq(statusPages.organizationId, organizationId)
            )
          );

        // Log audit event
        await logAuditEvent({
          userId,
          action: "status_page_domain_verified",
          resource: "status_page",
          resourceId: statusPageId,
          metadata: {
            organizationId,
            projectId: project.id,
            domain: statusPage.customDomain,
          },
          success: true,
        });

        revalidatePath(`/status-pages/${statusPageId}`);

        return {
          success: true,
          message: "Domain verified successfully!",
        };
      } else {
        return {
          success: false,
          message: `CNAME record found but points to ${cnames.join(", ")}. It should point to ${baseDomain}`,
        };
      }
    } catch (error) {
      console.error("DNS resolution error:", error);
      return {
        success: false,
        message:
          "Could not verify CNAME record. Please ensure it is set correctly and propagated.",
      };
    }
  } catch (error) {
    console.error("Error verifying status page domain:", error);
    return {
      success: false,
      message: "An unexpected error occurred during verification",
    };
  }
}
