import { NextResponse, NextRequest } from "next/server";
import { db } from "@/utils/db";
import { alertHistory } from "@/db/schema";
import { sql } from "drizzle-orm";
import { hasPermission } from '@/lib/rbac/middleware';
import { requireProjectContext } from '@/lib/project-context';

export async function GET() {
  try {
    console.log('Alert history API called');
    
    let userId: string, project: { id: string; name: string; organizationId: string }, organizationId: string;
    
    try {
      const context = await requireProjectContext();
      userId = context.userId;
      project = context.project;
      organizationId = context.organizationId;
      console.log('Project context:', { userId, projectId: project.id, organizationId });
    } catch (contextError) {
      console.error('Project context error:', contextError);
      // Return empty array if no project context available or authentication failed
      return NextResponse.json([]);
    }
    
    // Build permission context and check access
    try {
      console.log('Building permission context with:', { userId, organizationId, projectId: project.id });
      const canView = await hasPermission('monitor', 'view', { organizationId, projectId: project.id });
      console.log('Permission check result:', canView);
      
      if (!canView) {
        return NextResponse.json([]);
      }
    } catch (permissionError) {
      console.error('Permission check error:', permissionError);
      // Return empty array if permission check fails
      return NextResponse.json([]);
    }
    
    const dbInstance = db;
    console.log('Database instance created, starting queries...');
    
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
          WHERE j.organization_id = ${organizationId}
            AND j.project_id = ${project.id}
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
          WHERE m.organization_id = ${organizationId}
            AND m.project_id = ${project.id}
        )
        ORDER BY "timestamp" DESC
        LIMIT 50
      `);

      const history = historyResult as unknown as AlertHistoryRow[];
      console.log('Alert history query completed, count:', history.length);

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

      console.log('Transformation completed, returning data');
      return NextResponse.json(transformedHistory);
    } catch (dbError) {
      console.error('Database query error:', dbError);
      return NextResponse.json(
        { error: "Database query failed", details: dbError instanceof Error ? dbError.message : String(dbError) },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error fetching alert history:", error);
    return NextResponse.json(
      { error: "Failed to fetch alert history", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Require authentication and project context
    let projectContext;
    try {
      projectContext = await requireProjectContext();
    } catch {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { project, organizationId } = projectContext;

    // Check permission to manage monitors/jobs (alert creation requires manage permission)
    const canManage = await hasPermission('monitor', 'manage', {
      organizationId,
      projectId: project.id,
    });

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
