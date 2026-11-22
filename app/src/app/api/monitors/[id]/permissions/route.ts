import { liveMonitor } from "@/lib/deletion/visibility";
import { isUuid } from "@/lib/uuid";
import { NextRequest, NextResponse } from 'next/server';
import { resolveProjectPermissionContext, checkPermissionWithContext, forbiddenOrNotFound } from '@/lib/rbac/middleware';
import { requireUserAuthContext, isAuthError, authErrorStatus } from '@/lib/auth-context';
import { createLogger } from "@/lib/logger/index";

const logger = createLogger({ module: "monitor-permissions-api" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};
import { db } from '@/utils/db';
import { monitors } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { id } = params;

  if (!id) {
    return NextResponse.json({ error: "Monitor ID is required" }, { status: 400 });
  }

  try {
    const { userId, projectId: tokenProjectId, isCliAuth } = await requireUserAuthContext();

    // Find the monitor to get project and organization IDs
    if (!isUuid((await context.params).id)) return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    const monitor = await db.query.monitors.findFirst({
      where: and(eq(monitors.id, id), liveMonitor()),
      columns: {
        projectId: true,
        organizationId: true
      }
    });

    if (!monitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    if (isCliAuth && tokenProjectId !== monitor.projectId) {
      return NextResponse.json({ error: "CLI token does not authorize this project" }, { status: 403 });
    }

    if (!monitor.organizationId || !monitor.projectId) {
      // A row with no owner cannot be access-checked; answer like a missing monitor rather than confirming it exists.
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    // One role resolution for all four checks (hasPermissionForUser per action re-read the user's role each time).
    const permCtx = await resolveProjectPermissionContext(userId, monitor.projectId);
    if (!permCtx || !checkPermissionWithContext('monitor', 'view', permCtx)) {
      return await forbiddenOrNotFound(userId, monitor.organizationId, 'Insufficient permissions', 'Monitor not found');
    }
    // A super admin without membership reports super_admin, the role their permissions come from.
    const userRole = permCtx.project.userRole;
    const canEdit = checkPermissionWithContext('monitor', 'update', permCtx);
    const canDelete = checkPermissionWithContext('monitor', 'delete', permCtx);
    const canToggle = checkPermissionWithContext('monitor', 'manage', permCtx);

    return NextResponse.json({
      success: true,
      data: {
        userRole,
        canEdit,
        canDelete,
        canToggle,
        projectId: monitor.projectId,
        organizationId: monitor.organizationId
      }
    });

  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Authentication required' },
        { status: authErrorStatus(error) }
      );
    }

    logger.error({ err: error }, "Error fetching monitor permissions");
    
    if (error instanceof Error) {
      if (error.message === 'Authentication required') {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }
      
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { error: 'Resource not found or access denied' },
          { status: 404 }
        );
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to fetch permissions' },
      { status: 500 }
    );
  }
}