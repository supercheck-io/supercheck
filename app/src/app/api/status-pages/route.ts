import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";

/**
 * GET /api/status-pages
 * Fetches status pages for the current project with standardized pagination format.
 * Used by React Query hooks for client-side data fetching with caching.
 */
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();

    // Use current project context
    const targetProjectId = context.project.id;

    // PERFORMANCE: Use checkPermissionWithContext to avoid 5-8 duplicate DB queries
    const canView = checkPermissionWithContext("status_page", "view", context);

    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Parse pagination params (backward-compatible defaults)
    const searchParams = request.nextUrl.searchParams;
    const pageParam = Number.parseInt(searchParams.get("page") ?? "1", 10);
    const limitParam = Number.parseInt(searchParams.get("limit") ?? "100", 10);

    const page = Number.isNaN(pageParam) ? 1 : Math.max(1, pageParam);
    const limit = Number.isNaN(limitParam)
      ? 100
      : Math.min(100, Math.max(1, limitParam));
    const offset = (page - 1) * limit;

    // Count total records for pagination metadata
    const [countResult] = await db
      .select({ total: sql<number>`count(*)` })
      .from(statusPages)
      .where(
        and(
          eq(statusPages.organizationId, context.organizationId),
          eq(statusPages.projectId, targetProjectId)
        )
      );

    const total = Number(countResult?.total ?? 0);

    // Fetch paginated status pages for the current project
    const pages = await db
      .select()
      .from(statusPages)
      .where(
        and(
          eq(statusPages.organizationId, context.organizationId),
          eq(statusPages.projectId, targetProjectId)
        )
      )
      .orderBy(desc(statusPages.createdAt))
      .limit(limit)
      .offset(offset);

    // Map the database results to the expected format
    // Use spread operator with explicit overrides for date fields that need transformation
    const formattedPages = pages.map((page) => ({
      ...page,
      createdAt: page.createdAt
        ? new Date(page.createdAt).toISOString()
        : null,
      updatedAt: page.updatedAt
        ? new Date(page.updatedAt).toISOString()
        : null,
    }));

    // Return standardized response format for React Query hooks
    return NextResponse.json({
      data: formattedPages,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
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
