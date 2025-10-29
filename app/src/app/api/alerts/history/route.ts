import { NextResponse, NextRequest } from "next/server";
import { db } from "@/utils/db";
import { alertHistory, jobs, monitors, notificationProviders } from "@/db/schema";
import { desc, eq, and, sql } from "drizzle-orm";
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
      // Get alert history for jobs in this project
      console.log('Querying job alerts...');
      const jobAlerts = await dbInstance
        .select({
          id: alertHistory.id,
          targetType: alertHistory.targetType,
          monitorId: alertHistory.monitorId,
          jobId: alertHistory.jobId,
          target: alertHistory.target,
          type: alertHistory.type,
          message: alertHistory.message,
          status: alertHistory.status,
          timestamp: alertHistory.sentAt,
          providerId: alertHistory.provider,
          providerName: notificationProviders.name,
          providerType: notificationProviders.type,
          errorMessage: alertHistory.errorMessage,
          jobName: jobs.name,
          monitorName: sql`null`,
        })
        .from(alertHistory)
        .innerJoin(jobs, eq(alertHistory.jobId, jobs.id))
        .leftJoin(
          notificationProviders,
          sql`${notificationProviders.id}::text = ${alertHistory.provider}`
        )
        .where(and(
          eq(jobs.organizationId, organizationId),
          eq(jobs.projectId, project.id)
        ))
        .orderBy(desc(alertHistory.sentAt))
        .limit(25);
      
      console.log('Job alerts query completed, count:', jobAlerts.length);

      // Get alert history for monitors in this project
      console.log('Querying monitor alerts...');
      const monitorAlerts = await dbInstance
        .select({
          id: alertHistory.id,
          targetType: alertHistory.targetType,
          monitorId: alertHistory.monitorId,
          jobId: alertHistory.jobId,
          target: alertHistory.target,
          type: alertHistory.type,
          message: alertHistory.message,
          status: alertHistory.status,
          timestamp: alertHistory.sentAt,
          providerId: alertHistory.provider,
          providerName: notificationProviders.name,
          providerType: notificationProviders.type,
          errorMessage: alertHistory.errorMessage,
          jobName: sql`null`,
          monitorName: monitors.name,
        })
        .from(alertHistory)
        .innerJoin(monitors, eq(alertHistory.monitorId, monitors.id))
        .leftJoin(
          notificationProviders,
          sql`${notificationProviders.id}::text = ${alertHistory.provider}`
        )
        .where(and(
          eq(monitors.organizationId, organizationId),
          eq(monitors.projectId, project.id)
        ))
        .orderBy(desc(alertHistory.sentAt))
        .limit(25);
      
      console.log('Monitor alerts query completed, count:', monitorAlerts.length);

      // Combine and sort by timestamp
      const history = [...jobAlerts, ...monitorAlerts]
        .sort((a, b) => {
          const dateA = a.timestamp instanceof Date ? a.timestamp : new Date(String(a.timestamp));
          const dateB = b.timestamp instanceof Date ? b.timestamp : new Date(String(b.timestamp));
          return dateB.getTime() - dateA.getTime();
        })
        .slice(0, 50);

      console.log('Combined history count:', history.length);

      // Transform the data to match the expected format
      const transformedHistory = history.map(item => ({
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
