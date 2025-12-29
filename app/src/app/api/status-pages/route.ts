import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { desc, eq, and } from "drizzle-orm";
import { hasPermission } from "@/lib/rbac/middleware";
import { requireProjectContext } from "@/lib/project-context";

/**
 * GET /api/status-pages
 * Fetches status pages for the current project with standardized pagination format.
 * Used by React Query hooks for client-side data fetching with caching.
 */
export async function GET() {
  try {
    const { project, organizationId } = await requireProjectContext();

    // Use current project context
    const targetProjectId = project.id;

    // Check permission to view status pages
    const canView = await hasPermission("status_page", "view", {
      organizationId,
      projectId: targetProjectId,
    });

    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Fetch all status pages for the current project
    // OPTIMIZED: Added limit to prevent fetching unlimited records
    const DEFAULT_LIMIT = 100;
    const pages = await db
      .select()
      .from(statusPages)
      .where(
        and(
          eq(statusPages.organizationId, organizationId),
          eq(statusPages.projectId, targetProjectId)
        )
      )
      .orderBy(desc(statusPages.createdAt))
      .limit(DEFAULT_LIMIT);

    // Map the database results to the expected format
    const formattedPages = pages.map((page) => ({
      id: page.id,
      name: page.name,
      subdomain: page.subdomain,
      status: page.status,
      pageDescription: page.pageDescription,
      headline: page.headline,
      supportUrl: page.supportUrl,
      timezone: page.timezone,
      allowPageSubscribers: page.allowPageSubscribers,
      customDomain: page.customDomain,
      customDomainVerified: page.customDomainVerified,
      faviconLogo: page.faviconLogo,
      transactionalLogo: page.transactionalLogo,
      heroCover: page.heroCover,
      createdAt: page.createdAt
        ? new Date(page.createdAt).toISOString()
        : null,
      updatedAt: page.updatedAt
        ? new Date(page.updatedAt).toISOString()
        : null,
      projectId: page.projectId,
      organizationId: page.organizationId,
    }));

    // Return standardized response format for React Query hooks
    return NextResponse.json({
      data: formattedPages,
      pagination: {
        total: formattedPages.length,
        page: 1,
        limit: formattedPages.length,
        totalPages: 1,
      },
    });
  } catch (error) {
    console.error("Error fetching status pages:", error);

    // Return more detailed error information in development
    const isDevelopment = process.env.NODE_ENV === "development";

    return NextResponse.json(
      {
        error: "Failed to fetch status pages",
        details: isDevelopment ? (error as Error).message : undefined,
      },
      { status: 500 }
    );
  }
}
