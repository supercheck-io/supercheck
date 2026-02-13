import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { monitors } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUserAuthContext } from "@/lib/auth-context";
import { hasPermissionForUser } from '@/lib/rbac/middleware';
import { logAuditEvent } from "@/lib/audit-logger";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { id } = params;

  try {
    const { userId } = await requireUserAuthContext();
    const data = await request.json();
    const { status } = data;

    if (!status || !["up", "down", "paused", "pending", "maintenance", "error"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status value. Must be 'up', 'down', 'paused', 'pending', 'maintenance', or 'error'." },
        { status: 400 }
      );
    }

    // Get current monitor status for audit logging
    const currentMonitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
    });

    if (!currentMonitor) {
      return NextResponse.json(
        { error: "Monitor not found" },
        { status: 404 }
      );
    }

    // Check permission to manage/update monitor
    if (currentMonitor.organizationId && currentMonitor.projectId) {
      const canManage = await hasPermissionForUser(userId, 'monitor', 'manage', {
        organizationId: currentMonitor.organizationId,
        projectId: currentMonitor.projectId,
      });

      if (!canManage) {
        const canUpdate = await hasPermissionForUser(userId, 'monitor', 'update', {
          organizationId: currentMonitor.organizationId,
          projectId: currentMonitor.projectId,
        });

        if (!canUpdate) {
          return NextResponse.json(
            { error: "Insufficient permissions to manage monitor" },
            { status: 403 }
          );
        }
      }
    }

    // Update the monitor status in the database
    const [updatedMonitor] = await db
      .update(monitors)
      .set({
        status: status,
        updatedAt: new Date(),
      })
      .where(eq(monitors.id, id))
      .returning();

    if (!updatedMonitor) {
      return NextResponse.json(
        { error: "Monitor not found" },
        { status: 404 }
      );
    }

    // Log the audit event only for human actions (pause/unpause), not automated status changes
    const humanActions = ['paused', 'maintenance'];
    const isHumanAction = humanActions.includes(status) || 
                         (currentMonitor.status === 'paused' && ['up', 'down'].includes(status));
    
    if (isHumanAction) {
      await logAuditEvent({
        userId,
        organizationId: updatedMonitor.organizationId || undefined,
        action: status === 'paused' ? 'monitor_paused' : 
                currentMonitor.status === 'paused' ? 'monitor_resumed' : 
                `monitor_status_${status}`,
        resource: 'monitor',
        resourceId: id,
        metadata: {
          monitorName: updatedMonitor.name,
          previousStatus: currentMonitor.status,
          newStatus: status,
          projectId: updatedMonitor.projectId
        },
        success: true
      });
    }

    return NextResponse.json({ 
      success: true,
      id,
      status: updatedMonitor.status,
      updatedAt: updatedMonitor.updatedAt,
    });
    
  } catch (error) {
    console.error("Error updating monitor status:", error);
    return NextResponse.json(
      { error: "Failed to update monitor status" },
      { status: 500 }
    );
  }
} 