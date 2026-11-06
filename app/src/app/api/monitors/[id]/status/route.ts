import { isUuid } from "@/lib/uuid";
import { notInDeletedProject } from "@/lib/middleware/plan-limit-lock";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { monitors, projects } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { isAuthError, requireUserAuthContext, authErrorStatus } from "@/lib/auth-context";
import { resumeRefusalResponse, withResumeWithinPlan } from "@/lib/middleware/plan-enforcement";
import { monitorResumeBlockedResponse } from "@/lib/execution/trial-interval-response";
import { hasPermissionForUser } from '@/lib/rbac/middleware';
import { logAuditEvent } from "@/lib/audit-logger";
import { deleteScheduledMonitor, scheduleMonitor } from "@/lib/monitor-scheduler";
import type { MonitorJobData } from "@/lib/queue";
import { createLogger } from "@/lib/logger/index";

const logger = createLogger({ module: "monitor-status-api" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { id } = params;

  try {
    const { userId, projectId: tokenProjectId, isCliAuth } = await requireUserAuthContext();
    let data;
    try {
      data = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { status } = data;

    if (!status || !["up", "down", "paused", "pending"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status value. Must be 'up', 'down', 'paused' or 'pending'." },
        { status: 400 }
      );
    }

    // Get current monitor status for audit logging
    if (!isUuid((await context.params).id)) return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    // A soft-deleted project's monitors are gone for the user; they must not be resumable here.
    const currentMonitor = await db.query.monitors.findFirst({
      where: and(eq(monitors.id, id), notInDeletedProject(monitors.projectId)),
    });

    if (!currentMonitor) {
      return NextResponse.json(
        { error: "Monitor not found" },
        { status: 404 }
      );
    }

    if (isCliAuth && tokenProjectId !== currentMonitor.projectId) {
      return NextResponse.json({ error: "CLI token does not authorize this project" }, { status: 403 });
    }

    // Check permission to manage/update monitor
    if (!currentMonitor.organizationId || !currentMonitor.projectId) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }
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

    // A trial that ended pauses monitors; only subscribing may undo that.
    const resumeBlocked = await monitorResumeBlockedResponse(currentMonitor.organizationId, currentMonitor.status, { status });
    if (resumeBlocked) return resumeBlocked;

    // Update the monitor status in the database. Hold the live project row (FOR SHARE) so a
    // concurrent project delete cannot pause the monitor and then be overwritten by this write.
    const { organizationId: monitorOrgId, projectId: monitorProjectId } = currentMonitor;
    const write = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
      const [liveProject] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, monitorProjectId), ne(projects.status, 'deleted')))
        .for('share');
      if (!liveProject) return undefined;
      const [updated] = await tx
        .update(monitors)
        .set({
          status: status,
          // The scheduler skips a monitor with enabled=false, so the two move together (as in PATCH /api/monitors/{id}).
          enabled: status !== "paused",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(monitors.id, id),
            eq(monitors.organizationId, monitorOrgId),
            eq(monitors.projectId, monitorProjectId),
          ),
        )
        .returning();
      return updated;
    };
    // Turning a paused monitor back on takes a plan slot: count and write under the plan-limit lock.
    let updatedMonitor;
    if (currentMonitor.status === 'paused' && status !== 'paused') {
      const resumed = await withResumeWithinPlan(monitorOrgId, 'monitor', id, write);
      const refusal = resumeRefusalResponse(resumed);
      if (refusal) return refusal;
      updatedMonitor = resumed.ok ? resumed.value : undefined;
    } else {
      updatedMonitor = await db.transaction(write);
    }

    if (!updatedMonitor) {
      return NextResponse.json(
        { error: "Monitor not found" },
        { status: 404 }
      );
    }

    // Keep the schedule in step with pause and resume, as the monitor update paths do.
    const wasPaused = currentMonitor.status === "paused";
    const nowPaused = updatedMonitor.status === "paused";
    if (wasPaused !== nowPaused) {
      if (nowPaused) {
        const removed = currentMonitor.scheduledJobId
          ? await deleteScheduledMonitor(currentMonitor.scheduledJobId)
          : false;
        if (!removed) await deleteScheduledMonitor(id);
        await db.update(monitors).set({ scheduledJobId: null }).where(eq(monitors.id, id));
      } else if (updatedMonitor.frequencyMinutes > 0) {
        const schedulerId = await scheduleMonitor({
          monitorId: id,
          frequencyMinutes: updatedMonitor.frequencyMinutes,
          jobData: {
            monitorId: id,
            projectId: monitorProjectId,
            type: updatedMonitor.type as MonitorJobData["type"],
            target: updatedMonitor.target,
            config: updatedMonitor.config as Record<string, unknown>,
            frequencyMinutes: updatedMonitor.frequencyMinutes,
          },
          retryLimit: 3,
        });
        await db.update(monitors).set({ scheduledJobId: schedulerId }).where(eq(monitors.id, id));
      }
    }

    // Log the audit event only for human actions (pause/unpause), not automated status changes
    const humanActions = ['paused'];
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
    if (isAuthError(error)) {
      const status = authErrorStatus(error);
      return NextResponse.json({ error: error instanceof Error ? error.message : "Authentication required" }, { status });
    }
    logger.error({ err: error }, "Error updating monitor status");
    return NextResponse.json(
      { error: "Failed to update monitor status" },
      { status: 500 }
    );
  }
}
