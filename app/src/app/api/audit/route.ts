import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { auditLogs, user } from "@/db/schema";
import { desc, eq, and, ilike, count, SQL, sql } from "drizzle-orm";
import { getUserOrgRole } from '@/lib/rbac/middleware';
import { requireUserAuthContext, isAuthError, authErrorStatus } from '@/lib/auth-context';
import { Role } from '@/lib/rbac/permissions';
import { createLogger } from '@/lib/logger/pino-config';

const logger = createLogger({ module: 'audit-api' });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Postgres timestamptz text, microsecond precision, so a keyset cursor never skips or repeats a row.
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

function encodeCursor(createdAt: string, id: string) {
  return Buffer.from(`${createdAt}|${id}`).toString('base64url');
}

// Rejects dates the regex allows but Postgres would not (2026-02-31, hour 24), so a bad cursor is a 400, not a 500.
function isRealTimestamp(createdAt: string) {
  const [, y, mo, d, h, mi, sec] = createdAt.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/) ?? [];
  if (!y) return false;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec));
  return date.getUTCMonth() === +mo - 1 && date.getUTCDate() === +d && +h < 24 && +mi < 60 && +sec < 60;
}

function decodeCursor(raw: string): { createdAt: string; id: string } | null {
  const [createdAt, id, extra] = Buffer.from(raw, 'base64url').toString().split('|');
  if (extra !== undefined || !createdAt || !id || !TIMESTAMP_RE.test(createdAt) || !isRealTimestamp(createdAt) || !UUID_RE.test(id)) return null;
  return { createdAt, id };
}

export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId, projectId, isCliAuth } = await requireUserAuthContext();
    
    if (!organizationId) {
      logger.warn('No active organization found for audit request');
      return NextResponse.json(
        { success: false, error: "No active organization found" },
        { status: 404 }
      );
    }

    // Check if a user has permission to view audit logs (org admin or higher)
    const userRole = await getUserOrgRole(userId, organizationId);
    // Only org admins, owners, and super admins can view audit logs
    const canViewAuditLogs = userRole === Role.ORG_ADMIN || userRole === Role.ORG_OWNER || userRole === Role.SUPER_ADMIN;
    
    if (!canViewAuditLogs) {
      logger.warn('Unauthorized audit log access attempt');
      return NextResponse.json(
        { success: false, error: "Insufficient permissions to view audit logs" },
        { status: 403 }
      );
    }

    // Parse and validate query parameters
    const { searchParams } = new URL(request.url);
    const rawPage = Number.parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = Number.parseInt(searchParams.get('limit') || '10', 10);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 100)
      : 10;
    const sortOrderParam = searchParams.get('sortOrder');
    const sortOrder = sortOrderParam === 'asc' ? 'asc' : 'desc';
    const search = (searchParams.get('search') || '').trim().slice(0, 200);
    const action = (searchParams.get('action') || '').trim().slice(0, 100);

    // Keyset cursor: stable under inserts, unlike page offsets. When present it replaces `page`.
    const rawCursor = searchParams.get('cursor');
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) {
      return NextResponse.json({ success: false, error: "Invalid cursor" }, { status: 400 });
    }

    // Calculate offset
    const offset = cursor ? 0 : (page - 1) * limit;

    // Build where clause
    let whereClause: SQL<unknown> = eq(auditLogs.organizationId, organizationId);
    
    // Add search filter
    const searchConditions: SQL<unknown>[] = [];
    if (isCliAuth && projectId) searchConditions.push(sql`${auditLogs.details}->>'projectId' = ${projectId}`);
    if (search) {
      searchConditions.push(ilike(auditLogs.action, `%${search.replace(/[\\%_]/g, "\\$&")}%`));
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
    // id tiebreaker keeps pages stable when rows share a createdAt.
    const orderBy = sortOrder === 'desc' 
      ? [desc(auditLogs.createdAt), desc(auditLogs.id)]
      : [auditLogs.createdAt, auditLogs.id];

    const logsWhere = cursor
      ? and(
          whereClause,
          sortOrder === 'desc'
            ? sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
            : sql`(${auditLogs.createdAt}, ${auditLogs.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
        )
      : whereClause;

    // Fetch one extra row to know whether another page follows.
    const fetched = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
        userId: auditLogs.userId,
        userName: user.name,
        userEmail: user.email,
        userImage: user.image,
        // to_char, not ::text: the text form follows the session DateStyle, which the cursor parser must not depend on.
        createdAtCursor: sql<string>`to_char(${auditLogs.createdAt} at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'`,
      })
      .from(auditLogs)
      .leftJoin(user, eq(auditLogs.userId, user.id))
      .where(logsWhere)
      .orderBy(...orderBy)
      .limit(limit + 1)
      .offset(offset);
    const auditData = fetched.slice(0, limit);
    const last = auditData.at(-1);
    const nextCursor =
      fetched.length > limit && last?.createdAtCursor ? encodeCursor(last.createdAtCursor, last.id) : null;

    // Get unique actions for filter dropdown
    const uniqueActions = await db
      .selectDistinct({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), isCliAuth && projectId ? sql`${auditLogs.details}->>'projectId' = ${projectId}` : undefined))
      .orderBy(auditLogs.action);

    const totalPages = Math.ceil(totalCount / limit);

    const response = {
      success: true,
      data: {
        // Lets a client that is loading pages detect an organization switch between requests.
        organizationId,
        logs: auditData.map(log => ({
          id: log.id,
          action: log.action,
          details: log.details,
          createdAt: log.createdAt?.toISOString(),
          user: {
            id: log.userId,
            name: log.userName,
            email: log.userEmail,
            image: log.userImage
          }
        })),
        // Offset fields (page, totalPages, hasPrev) describe nothing in cursor mode, so they are left out.
        pagination: cursor
          ? { totalCount, limit, hasNext: nextCursor !== null, nextCursor }
          : {
              currentPage: page,
              totalPages,
              totalCount,
              limit,
              hasNext: page < totalPages,
              hasPrev: page > 1,
              nextCursor
            },
        filters: {
          actions: uniqueActions.map(a => a.action).filter(Boolean)
        }
      }
    };

    return NextResponse.json(response);

  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : 'Authentication required' },
        { status: authErrorStatus(error) }
      );
    }
    logger.error({ err: error }, 'Audit API error');
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch audit logs'
      },
      { status: 500 }
    );
  }
}