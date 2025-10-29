import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { monitors, monitorResults } from "@/db/schema";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { requireAuth, hasPermission, getUserOrgRole } from '@/lib/rbac/middleware';
import { isSuperAdmin } from '@/lib/admin';
import { isMonitoringLocation } from "@/lib/location-service";
import type { MonitoringLocation } from "@/lib/location-service";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { id } = params;
  
  if (!id) {
    return NextResponse.json({ error: "Monitor ID is required" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '10', 10);
  const dateFilter = searchParams.get('date'); // YYYY-MM-DD format
  const locationParam = searchParams.get("location"); // Optional location filter
  const locationFilter: MonitoringLocation | null = isMonitoringLocation(
    locationParam
  )
    ? (locationParam as MonitoringLocation)
    : null;

  // Validate pagination parameters
  if (page < 1 || limit < 1 || limit > 100) {
    return NextResponse.json({
      error: "Invalid pagination parameters. Page must be >= 1, limit must be 1-100"
    }, { status: 400 });
  }

  try {
    const { userId } = await requireAuth();
    
    // First, find the monitor to check permissions
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
    });

    if (!monitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    // Check if user has access to this monitor
    const userIsSuperAdmin = await isSuperAdmin();
    
    if (!userIsSuperAdmin && monitor.organizationId && monitor.projectId) {
      // First, check if user is a member of the organization
      const orgRole = await getUserOrgRole(userId, monitor.organizationId);
      
      if (!orgRole) {
        return NextResponse.json(
          { error: 'Access denied: Not a member of this organization' },
          { status: 403 }
        );
      }

      // Then check if they have permission to view monitors
      try {
        const canView = await hasPermission('monitor', 'view', { 
          organizationId: monitor.organizationId, 
          projectId: monitor.projectId 
        });
        
        if (!canView) {
          return NextResponse.json(
            { error: 'Insufficient permissions to view this monitor' },
            { status: 403 }
          );
        }
      } catch (permissionError) {
        // If permission check fails but user is org member, allow view access
        console.log('Permission check failed, but user is org member:', permissionError);
      }
    }

    // Calculate offset for pagination
    const offset = (page - 1) * limit;

    // Build where condition with optional date and location filters
    const conditions = [eq(monitorResults.monitorId, id)];

    if (dateFilter) {
      conditions.push(
        gte(monitorResults.checkedAt, new Date(dateFilter + 'T00:00:00.000Z')),
        lte(monitorResults.checkedAt, new Date(dateFilter + 'T23:59:59.999Z'))
      );
    }

    if (locationFilter) {
      conditions.push(eq(monitorResults.location, locationFilter));
    }

    const whereCondition = conditions.length > 1 ? and(...conditions) : conditions[0];

    // Get total count for pagination metadata
    const [{ count: totalCount }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(monitorResults)
      .where(whereCondition);

    const total = Number(totalCount);

    // Get the specific page of results
    const results = await db
      .select()
      .from(monitorResults)
      .where(whereCondition)
      .orderBy(desc(monitorResults.checkedAt))
      .limit(limit)
      .offset(offset);

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return NextResponse.json({
      data: results,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    console.error(`Error fetching paginated monitor results for ${id}:`, error);
    return NextResponse.json({ error: "Failed to fetch monitor results" }, { status: 500 });
  }
}
