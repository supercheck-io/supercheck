"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { revalidatePath } from "next/cache";
import { resolve4, resolve6, resolveCname } from "node:dns/promises";
import { z } from "zod";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  getStatusPageCustomDomainConfigError,
  getEffectiveStatusPageCnameTarget,
  getEffectiveStatusPageDomain,
  getStatusPageDomainVerificationTargets,
  isReservedStatusPageHostname,
} from "@/lib/status-page-domain";
import { getStatusPageCustomDomainTargetResolutionError } from "@/lib/status-page-domain-guidance";

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

    const customDomainConfigError = getStatusPageCustomDomainConfigError();
    if (customDomainConfigError) {
      return {
        success: false,
        message: customDomainConfigError,
      };
    }

    const baseDomain = getEffectiveStatusPageDomain();
    const customDomainCnameTarget = getEffectiveStatusPageCnameTarget();
    if (isReservedStatusPageHostname(statusPage.customDomain, baseDomain)) {
      return {
        success: false,
        message: `Custom domain cannot use ${baseDomain} or its subdomains. Use a separate hostname and point its CNAME to ${customDomainCnameTarget}.`,
      };
    }

    // Verify DNS
    try {
      const cnames = await resolveCname(statusPage.customDomain);
      const validTargets = getStatusPageDomainVerificationTargets();

      // SECURITY: Use exact canonical hostname matching (case-insensitive, trailing-dot normalized)
      // DNS CNAME records may include a trailing dot (e.g., "supercheck.io.")
      const normalizeDnsName = (name: string) =>
        name.toLowerCase().replace(/\.$/, "");

      const matchedTargets = cnames.filter((cname) =>
        validTargets.some(
          (target) => normalizeDnsName(cname) === normalizeDnsName(target)
        )
      );

      const targetHasAddress = async (hostname: string): Promise<boolean> => {
        const normalizedHostname = normalizeDnsName(hostname);
        const [aRecordResult, aaaaRecordResult] = await Promise.allSettled([
          resolve4(normalizedHostname),
          resolve6(normalizedHostname),
        ]);

        const hasIpv4 =
          aRecordResult.status === "fulfilled" && aRecordResult.value.length > 0;
        const hasIpv6 =
          aaaaRecordResult.status === "fulfilled" &&
          aaaaRecordResult.value.length > 0;

        return hasIpv4 || hasIpv6;
      };

      if (matchedTargets.length > 0) {
        const targetResolutionChecks = await Promise.all(
          matchedTargets.map((target) => targetHasAddress(target))
        );
        const hasReachableTarget = targetResolutionChecks.some(Boolean);

        if (!hasReachableTarget) {
          return {
            success: false,
            message: getStatusPageCustomDomainTargetResolutionError(
              matchedTargets
            ),
          };
        }

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
              eq(statusPages.organizationId, organizationId),
              eq(statusPages.projectId, project.id)
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
          message: `CNAME record found but points to ${cnames.join(", ")}. It should point to ${customDomainCnameTarget}`,
        };
      }
    } catch (cnameError) {
      // CNAME resolution failed — this commonly happens when a CDN or DNS
      // provider (e.g. Cloudflare with proxy enabled) flattens the CNAME
      // into A/AAAA records. Detect this case and give the user a specific,
      // actionable error message instead of the generic "not propagated" one.
      try {
        const [aResult, aaaaResult] = await Promise.allSettled([
          resolve4(statusPage.customDomain),
          resolve6(statusPage.customDomain),
        ]);

        const hasAddressRecords =
          (aResult.status === "fulfilled" && aResult.value.length > 0) ||
          (aaaaResult.status === "fulfilled" && aaaaResult.value.length > 0);

        if (hasAddressRecords) {
          return {
            success: false,
            message:
              `The domain resolves but the CNAME record is not visible. ` +
              `This typically happens when a CDN or proxy (like Cloudflare) flattens the record. ` +
              `Temporarily set your DNS record to "DNS only" (grey cloud in Cloudflare), ` +
              `click Verify DNS again, then re-enable the proxy afterwards.`,
          };
        }
      } catch {
        // A/AAAA lookup also failed — fall through to generic message
      }

      console.error("DNS resolution error:", cnameError);
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
