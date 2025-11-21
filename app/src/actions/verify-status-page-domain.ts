"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { revalidatePath } from "next/cache";
import { resolveCname } from "node:dns/promises";

export async function verifyStatusPageDomain(statusPageId: string) {
  try {
    const { organizationId, project } = await requireProjectContext();
    await requirePermissions(
      { status_page: ["update"] },
      { organizationId, projectId: project.id }
    );

    // Get status page
    const statusPage = await db.query.statusPages.findFirst({
      where: eq(statusPages.id, statusPageId),
    });

    if (!statusPage) {
      return {
        success: false,
        message: "Status page not found",
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
      
      // Check if any of the CNAMEs point to supercheck.io (or the configured app domain)
      // In a real scenario, this might be a specific CNAME target like "cname.supercheck.io"
      const validTargets = ["supercheck.io", "cname.supercheck.io", "ingress.supercheck.io"];
      const isValid = cnames.some(cname => validTargets.some(target => cname.includes(target)));

      if (isValid) {
        // Update status page
        await db
          .update(statusPages)
          .set({
            customDomainVerified: true,
            updatedAt: new Date(),
          })
          .where(eq(statusPages.id, statusPageId));

        revalidatePath(`/status-pages/${statusPageId}`);
        
        return {
          success: true,
          message: "Domain verified successfully!",
        };
      } else {
        return {
          success: false,
          message: `CNAME record found but points to ${cnames.join(", ")}. It should point to supercheck.io`,
        };
      }
    } catch (error) {
      console.error("DNS resolution error:", error);
      return {
        success: false,
        message: "Could not verify CNAME record. Please ensure it is set correctly and propagated.",
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
