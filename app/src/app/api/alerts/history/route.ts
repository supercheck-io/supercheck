import { NextResponse, NextRequest } from "next/server";
import { db } from "@/utils/db";
import { alertHistory } from "@/db/schema";
import { sql } from "drizzle-orm";
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { requireAuthContext, isAuthError } from '@/lib/auth-context';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const rawPage = url.searchParams.get('page');
    const rawLimit = url.searchParams.get('limit');
    const MAX_LIMIT = 200;
    const DEFAULT_LIMIT = 50;
    const limit = rawLimit
      ? Math.min(Math.max(1, Math.floor(Number(rawLimit)) || DEFAULT_LIMIT), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const isPaginatedRequest = rawPage !== null;
    const page = isPaginatedRequest
      ? Math.max(1, Math.floor(Number(rawPage)) || 1)
      : 1;
    const offset = isPaginatedRequest ? (page - 1) * limit : 0;

    const context = await requireAuthContext();
    
    // PERFORMANCE: Use checkPermissionWithContext to avoid 5-8 duplicate DB queries
    const canView = checkPermissionWithContext('monitor', 'view', context);
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    
    const dbInstance = db;
    
    try {
      // OPTIMIZED: Use UNION ALL to fetch both job and monitor alerts in a single query
      // This reduces 2 queries to 1 and lets the database handle sorting
      type AlertHistoryRow = {
        id: string;
        targetType: string;
        monitorId: string | null;
        jobId: string | null;
        target: string;
        type: string;
        message: string;
        status: string;
        timestamp: Date;
        providerId: string | null;
        providerName: string | null;
        providerType: string | null;
        errorMessage: string | null;
        jobName: string | null;
        monitorName: string | null;
      };

      const total = isPaginatedRequest
        ? await dbInstance.execute(sql`
            WITH history AS (
              (
                SELECT ah.id
                FROM alert_history ah
                INNER JOIN jobs j ON ah.job_id = j.id
                WHERE j.organization_id = ${context.organizationId}
                  AND j.project_id = ${context.project.id}
              )
              UNION ALL
              (
                SELECT ah.id
                FROM alert_history ah
                INNER JOIN monitors m ON ah.monitor_id = m.id
                WHERE m.organization_id = ${context.organizationId}
                  AND m.project_id = ${context.project.id}
              )
            )
            SELECT count(*)::int as total FROM history
          `)
        : null;

      const historyResult = await dbInstance.execute(sql`
        (
          SELECT 
            ah.id,
            ah.target_type as "targetType",
            ah.monitor_id as "monitorId",
            ah.job_id as "jobId",
            ah.target,
            ah.type,
            ah.message,
            ah.status,
            ah.sent_at as "timestamp",
            ah.provider as "providerId",
            np.name as "providerName",
            np.type as "providerType",
            ah.error_message as "errorMessage",
            j.name as "jobName",
            NULL as "monitorName"
          FROM alert_history ah
          INNER JOIN jobs j ON ah.job_id = j.id
          LEFT JOIN notification_providers np ON np.id::text = ah.provider
          WHERE j.organization_id = ${context.organizationId}
            AND j.project_id = ${context.project.id}
        )
        UNION ALL
        (
          SELECT 
            ah.id,
            ah.target_type as "targetType",
            ah.monitor_id as "monitorId",
            ah.job_id as "jobId",
            ah.target,
            ah.type,
            ah.message,
            ah.status,
            ah.sent_at as "timestamp",
            ah.provider as "providerId",
            np.name as "providerName",
            np.type as "providerType",
            ah.error_message as "errorMessage",
            NULL as "jobName",
            m.name as "monitorName"
          FROM alert_history ah
          INNER JOIN monitors m ON ah.monitor_id = m.id
          LEFT JOIN notification_providers np ON np.id::text = ah.provider
          WHERE m.organization_id = ${context.organizationId}
            AND m.project_id = ${context.project.id}
        )
        ORDER BY "timestamp" DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `);
      
      const history = historyResult as unknown as AlertHistoryRow[];

      // Transform the data to match the expected format
      const transformedHistory = history.map((item: AlertHistoryRow) => ({
        id: item.id,
        targetType: item.targetType,
        targetId: item.monitorId || item.jobId || '',
        targetName: item.jobName || item.monitorName || item.target || 'Unknown',
        type: item.type,
        message: item.message,
        status: item.status,
        timestamp: item.timestamp,
        notificationProvider:
          item.providerType ||
          item.providerName ||
          item.providerId ||
          'Unknown',
        metadata: {
          errorMessage: item.errorMessage,
        },
      }));

      if (!isPaginatedRequest) {
        return NextResponse.json(transformedHistory);
      }

      const totalCount = Number((total as unknown as Array<{ total: number }>)[0]?.total ?? 0);
      const totalPages = Math.ceil(totalCount / limit);
      return NextResponse.json({
        data: transformedHistory,
        pagination: {
          total: totalCount,
          page,
          limit,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    } catch (dbError) {
      console.error('[AlertHistory] Database query error:', dbError);
      return NextResponse.json(
        { error: "Database query failed", details: dbError instanceof Error ? dbError.message : String(dbError) },
        { status: 500 }
      );
    }
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("[AlertHistory] Error fetching alert history:", error);
    return NextResponse.json(
      { error: "Failed to fetch alert history", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Require authentication and project context
    let projectContext: { userId: string; project: { id: string; name: string; organizationId: string; userRole: string }; organizationId: string; isCliAuth: boolean };
    try {
      projectContext = await requireAuthContext();
    } catch (error) {
      if (isAuthError(error)) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Authentication required" },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // PERFORMANCE: Use checkPermissionWithContext to avoid 5-8 duplicate DB queries
    const canManage = checkPermissionWithContext('monitor', 'manage', projectContext);

    if (!canManage) {
      return NextResponse.json(
        { error: 'Insufficient permissions to create alert history' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const dbInstance = db;
    
    // Validate required fields
    if (!body.type || !body.message || !body.target || !body.targetType || !body.provider) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate target type
    if (!['monitor', 'job'].includes(body.targetType)) {
      return NextResponse.json(
        { error: "Invalid target type" },
        { status: 400 }
      );
    }

    // Validate status
    if (!['sent', 'failed', 'pending'].includes(body.status)) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 }
      );
    }

    // Validate alert type
    const validAlertTypes = [
      'monitor_failure',
      'monitor_recovery',
      'job_failed',
      'job_success',
      'job_timeout',
      'ssl_expiring'
    ];
    if (!validAlertTypes.includes(body.type)) {
      return NextResponse.json(
        { error: "Invalid alert type" },
        { status: 400 }
      );
    }

    // Insert new alert history entry
    const [result] = await dbInstance
      .insert(alertHistory)
      .values({
        type: body.type,
        message: body.message,
        target: body.target,
        targetType: body.targetType,
        monitorId: body.monitorId || null,
        jobId: body.jobId || null,
        provider: body.provider,
        status: body.status,
        errorMessage: body.errorMessage || null,
        sentAt: new Date(),
      })
      .returning();

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error saving alert history:", error);
    return NextResponse.json(
      { error: "Failed to save alert history" },
      { status: 500 }
    );
  }
}