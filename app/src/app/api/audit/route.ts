import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { auditLogs, user } from "@/db/schema";
import { desc, eq, and, ilike, count, SQL } from "drizzle-orm";
import { requireAuth, getUserOrgRole } from '@/lib/rbac/middleware';
import { getActiveOrganization } from '@/lib/session';
import { Role } from '@/lib/rbac/permissions';
import { createLogger } from '@/lib/logger/pino-config';

const logger = createLogger({ module: 'audit-api' });

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    
    // Get current organization context
    const activeOrg = await getActiveOrganization();
    
    if (!activeOrg) {
      logger.warn('No active organization found for audit request');
      return NextResponse.json(
        { success: false, error: "No active organization found" },
        { status: 404 }
      );
    }

    // Check if a user has permission to view audit logs (org admin or higher)
    const userRole = await getUserOrgRole(userId, activeOrg.id);
    // Only org admins, owners, and super admins can view audit logs
    const canViewAuditLogs = userRole === Role.ORG_ADMIN || userRole === Role.ORG_OWNER || userRole === Role.SUPER_ADMIN;
    
    if (!canViewAuditLogs) {
      logger.warn('Unauthorized audit log access attempt');
      return NextResponse.json(
        { success: false, error: "Insufficient permissions to view audit logs" },
        { status: 403 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const search = searchParams.get('search') || '';
    const action = searchParams.get('action') || '';

    // Calculate offset
    const offset = (page - 1) * limit;

    // Build where clause
    let whereClause: SQL<unknown> = eq(auditLogs.organizationId, activeOrg.id);
    
    // Add search filter
    const searchConditions: SQL<unknown>[] = [];
    if (search) {
      searchConditions.push(ilike(auditLogs.action, `%${search}%`));
    }
    
    if (action) {
      searchConditions.push(eq(auditLogs.action, action));
    }

    // Combine where conditions
    if (searchConditions.length > 0) {
      whereClause = and(whereClause, ...searchConditions) as SQL<unknown>;
    }

    // Get total count for pagination
    const [totalCountResult] = await db
      .select({ count: count() })
      .from(auditLogs)
      .where(whereClause);

    const totalCount = totalCountResult?.count || 0;

    // Build order by clause
    const orderBy = sortOrder === 'desc' 
      ? desc(auditLogs.createdAt)
      : auditLogs.createdAt;

    // Fetch audit logs with user information
    const auditData = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
        userId: auditLogs.userId,
        userName: user.name,
        userEmail: user.email,
      })
      .from(auditLogs)
      .leftJoin(user, eq(auditLogs.userId, user.id))
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    // Get unique actions for filter dropdown
    const uniqueActions = await db
      .selectDistinct({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, activeOrg.id))
      .orderBy(auditLogs.action);

    const totalPages = Math.ceil(totalCount / limit);

    const response = {
      success: true,
      data: {
        logs: auditData.map(log => ({
          id: log.id,
          action: log.action,
          details: log.details,
          createdAt: log.createdAt?.toISOString(),
          user: {
            id: log.userId,
            name: log.userName,
            email: log.userEmail
          }
        })),
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          limit,
          hasNext: page < totalPages,
          hasPrev: page > 1
        },
        filters: {
          actions: uniqueActions.map(a => a.action).filter(Boolean)
        }
      }
    };

    return NextResponse.json(response);

  } catch (error) {
    logger.error({ err: error }, 'Audit API error');
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch audit logs',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}