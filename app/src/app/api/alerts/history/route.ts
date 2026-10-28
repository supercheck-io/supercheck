import { NextResponse, NextRequest } from "next/server";
import { db } from "@/utils/db";
import { alertHistory, jobs, monitors, type AlertDeliveryMetadata } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { requireAuthContext, isAuthError } from '@/lib/auth-context';
import { enqueueSreAlertTriageJob } from '@/sre/lib/background-alert-triage-queue';
import { isUuid } from '@/lib/uuid';
import { checkSreAlertHistoryWriteRateLimit } from '@/lib/sre/sre-rate-limiter';

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
        deliveryMetadata: AlertDeliveryMetadata | null;
        jobName: string | null;
        monitorName: string | null;
      };
      const hasDeliveryMetadataColumn =
        await alertHistoryDeliveryMetadataColumnExists(dbInstance);
      const deliveryMetadataSelect = hasDeliveryMetadataColumn
        ? sql`ah.delivery_metadata`
        : sql`NULL::jsonb`;

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
            ${deliveryMetadataSelect} as "deliveryMetadata",
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
            ${deliveryMetadataSelect} as "deliveryMetadata",
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

      // The incident each alert belonged to: the earliest incident of the same source that was not yet
      // resolved when the alert was sent (same alert type first). Creation time is not compared, since a
      // queue backlog can create the incident well after the alert.
      const ids = history.map((item) => item.id);
      const incidentRows = ids.length
        ? ((await dbInstance.execute(sql`
            SELECT DISTINCT ON (ah.id) ah.id AS "alertId", i.id AS "incidentId", i.incident_number AS "incidentNumber"
            FROM alert_history ah
            JOIN sre_alert_events e
              ON e.source_id = coalesce(ah.monitor_id, ah.job_id)
             AND e.organization_id = ${context.organizationId}
             AND e.project_id = ${context.project.id}
            JOIN sre_incident_alerts ia ON ia.alert_event_id = e.id
            JOIN sre_incidents i ON i.id = ia.incident_id
            WHERE ah.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
              -- Same alert type, or a recovery matched to the up/down failure it recovers.
              AND (
                e.dedup_key LIKE '%:' || ah.type
                OR (ah.type IN ('monitor_recovery', 'job_success') AND e.dedup_key ~ ':(monitor_failure|job_failed|job_timeout)$')
              )
              -- Open when the alert was sent; an hour of slack covers a queue backlog.
              AND i.created_at <= ah.sent_at + interval '1 hour'
              AND (i.resolved_at IS NULL OR i.resolved_at >= ah.sent_at - interval '1 minute')
            ORDER BY ah.id, i.created_at ASC
          `)) as unknown as Array<{ alertId: string; incidentId: string; incidentNumber: number }>)
        : [];
      const incidentByAlert = new Map(
        incidentRows.map((row) => [row.alertId, { id: row.incidentId, number: Number(row.incidentNumber) }]),
      );

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
        incident: incidentByAlert.get(item.id) ?? null,
        notificationProvider:
          item.providerType ||
          item.providerName ||
          item.providerId ||
          'Unknown',
        metadata: {
          errorMessage: item.errorMessage,
          delivery: item.deliveryMetadata?.delivery,
          correlation: item.deliveryMetadata?.correlation,
          provider: item.deliveryMetadata?.provider,
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
        { error: "Database query failed" },
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
      { error: "Failed to fetch alert history" },
      { status: 500 }
    );
  }
}

async function alertHistoryDeliveryMetadataColumnExists(
  dbInstance: Pick<typeof db, "execute">,
): Promise<boolean> {
  const result = await dbInstance.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'alert_history'
        AND column_name = 'delivery_metadata'
    ) as "exists"
  `);
  const rows = result as unknown as Array<{ exists?: boolean | string | number }>;
  const value = rows[0]?.exists;
  return value === true || value === "true" || value === 1;
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
    // A recorded alert can open or resolve an incident, so it needs incident rights too.
    const canManage =
      checkPermissionWithContext('monitor', 'manage', projectContext) &&
      checkPermissionWithContext('sre_incident', 'update', projectContext);

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

    // Columns are varchar(255)/varchar(100)/text; cap before they reach the DB and the triage queue.
    const tooLong = (v: unknown, max: number) => typeof v !== "string" || v.length > max;
    if (
      tooLong(body.message, 2000) || tooLong(body.target, 255) || tooLong(body.provider, 100) ||
      (body.errorMessage != null && tooLong(body.errorMessage, 2000))
    ) {
      return NextResponse.json({ error: "Invalid or oversized field" }, { status: 400 });
    }

    const limit = await checkSreAlertHistoryWriteRateLimit(projectContext.userId);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
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

    // The row can open or resolve an incident for its source, so the source must be in the caller's project.
    const sourceId = body.targetType === "monitor" ? body.monitorId : body.jobId;
    const otherId = body.targetType === "monitor" ? body.jobId : body.monitorId;
    if (typeof sourceId !== "string" || !isUuid(sourceId) || otherId) {
      return NextResponse.json(
        { error: `${body.targetType}Id is required and must match targetType` },
        { status: 400 }
      );
    }
    const table = body.targetType === "monitor" ? monitors : jobs;
    const [source] = await dbInstance
      .select({ id: table.id })
      .from(table)
      .where(and(
        eq(table.id, sourceId),
        eq(table.organizationId, projectContext.organizationId),
        eq(table.projectId, projectContext.project.id),
      ))
      .limit(1);
    if (!source) {
      return NextResponse.json({ error: `${body.targetType} not found` }, { status: 404 });
    }

    // Insert new alert history entry
    const [result] = await dbInstance
      .insert(alertHistory)
      .values({
        type: body.type,
        message: body.message,
        target: body.target,
        targetType: body.targetType,
        monitorId: body.targetType === "monitor" ? sourceId : null,
        jobId: body.targetType === "job" ? sourceId : null,
        provider: body.provider,
        status: body.status,
        errorMessage: body.errorMessage || null,
        sentAt: new Date(),
      })
      .returning();

    try {
      await enqueueSreAlertTriageJob({ alertHistoryId: result.id });
    } catch (error) {
      console.error("Error enqueueing SRE alert triage job:", error);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error saving alert history:", error);
    return NextResponse.json(
      { error: "Failed to save alert history" },
      { status: 500 }
    );
  }
}
