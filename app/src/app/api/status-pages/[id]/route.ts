import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { statusPages, statusPageComponents, monitors } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { hasPermission } from "@/lib/rbac/middleware";
import { requireProjectContext } from "@/lib/project-context";
import { generateProxyUrl } from "@/lib/asset-proxy";
import { z } from "zod";

// UUID validation schema
const uuidSchema = z.string().uuid("Invalid status page ID format");

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/**
 * GET /api/status-pages/[id]
 * Fetches a single status page with all related data (monitors, components, permissions).
 * Used by React Query hooks for client-side data fetching with caching.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    // Validate UUID format
    const validationResult = uuidSchema.safeParse(id);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid status page ID" },
        { status: 400 }
      );
    }

    const { project, organizationId } = await requireProjectContext();
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

    // Check update permission
    const canUpdate = await hasPermission("status_page", "update", {
      organizationId,
      projectId: targetProjectId,
    });

    // Fetch the status page
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, id),
        eq(statusPages.organizationId, organizationId),
        eq(statusPages.projectId, targetProjectId)
      ),
    });

    if (!statusPage) {
      return NextResponse.json(
        { error: "Status page not found" },
        { status: 404 }
      );
    }

    // Fetch components with monitors using eager loading
    const components = await db.query.statusPageComponents.findMany({
      where: eq(statusPageComponents.statusPageId, id),
      orderBy: (components, { asc }) => [
        asc(components.position),
        asc(components.createdAt),
      ],
      with: {
        monitors: {
          with: {
            monitor: {
              columns: {
                id: true,
                name: true,
                type: true,
                status: true,
                target: true,
              },
            },
          },
        },
      },
    });

    // Fetch all monitors for the project (for adding to components)
    const projectMonitors = await db.query.monitors.findMany({
      where: eq(monitors.projectId, targetProjectId),
      orderBy: (monitors, { asc }) => [asc(monitors.name)],
      columns: {
        id: true,
        name: true,
        type: true,
        status: true,
      },
    });

    // Transform components data
    const componentsWithMonitors = components.map((component) => {
      const linkedMonitors = component.monitors
        .filter((assoc) => assoc.monitor)
        .map((assoc) => ({
          ...assoc.monitor,
          weight: assoc.weight,
        }));

      return {
        ...component,
        monitors: linkedMonitors,
        monitorIds: linkedMonitors.map((m) => m.id),
      };
    });

    // Generate proxy URLs for logo assets
    const faviconUrl = generateProxyUrl(statusPage.faviconLogo);
    const logoUrl = generateProxyUrl(statusPage.transactionalLogo);
    const coverUrl = generateProxyUrl(statusPage.heroCover);

    // Return consolidated response with all needed data
    return NextResponse.json({
      statusPage: {
        ...statusPage,
        faviconLogo: faviconUrl,
        transactionalLogo: logoUrl,
        heroCover: coverUrl,
        createdAt: statusPage.createdAt?.toISOString() ?? null,
        updatedAt: statusPage.updatedAt?.toISOString() ?? null,
      },
      components: componentsWithMonitors,
      monitors: projectMonitors,
      canUpdate,
    });
  } catch (error) {
    console.error("Error fetching status page:", error);

    const isDevelopment = process.env.NODE_ENV === "development";

    return NextResponse.json(
      {
        error: "Failed to fetch status page",
        details: isDevelopment ? (error as Error).message : undefined,
      },
      { status: 500 }
    );
  }
}
