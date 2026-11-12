import { isUuid } from "@/lib/uuid";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import {
  monitorNotificationSettings,
  jobNotificationSettings,
  monitors,
  jobs,
  notificationProviders,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { liveJob, liveMonitor } from "@/lib/deletion/visibility";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError, authErrorStatus } from "@/lib/auth-context";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const authContext = await requireAuthContext();
    const { project, organizationId } = authContext;

    // PERFORMANCE: Use checkPermissionWithContext to avoid duplicate DB queries
    const canView = checkPermissionWithContext("notification", "view", authContext);

    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Verify the provider belongs to this organization and project
    if (!isUuid((await context.params).id)) return NextResponse.json({ error: "Notification provider not found" }, { status: 404 });
    const [provider] = await db
      .select({ id: notificationProviders.id })
      .from(notificationProviders)
      .where(
        and(
          eq(notificationProviders.id, id),
          eq(notificationProviders.organizationId, organizationId),
          eq(notificationProviders.projectId, project.id)
        )
      );

    if (!provider) {
      return NextResponse.json(
        { error: "Notification provider not found" },
        { status: 404 }
      );
    }

    // Check if provider is in use by any monitors or jobs
    const [monitorUsage, jobUsage] = await Promise.all([
      db
        .select({ monitorId: monitorNotificationSettings.monitorId })
        .from(monitorNotificationSettings)
        .innerJoin(monitors, eq(monitors.id, monitorNotificationSettings.monitorId))
        .where(and(eq(monitorNotificationSettings.notificationProviderId, id), liveMonitor())),
      db
        .select({ jobId: jobNotificationSettings.jobId })
        .from(jobNotificationSettings)
        .innerJoin(jobs, eq(jobs.id, jobNotificationSettings.jobId))
        .where(and(eq(jobNotificationSettings.notificationProviderId, id), liveJob())),
    ]);

    const isInUse = monitorUsage.length > 0 || jobUsage.length > 0;

    return NextResponse.json({
      isInUse,
      usage: {
        monitors: monitorUsage.length,
        jobs: jobUsage.length,
        details: {
          monitorIds: monitorUsage.map((m) => m.monitorId),
          jobIds: jobUsage.map((j) => j.jobId),
        },
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: authErrorStatus(error) }
      );
    }
    console.error("Error checking notification provider usage:", error);
    return NextResponse.json(
      { error: "Failed to check provider usage" },
      { status: 500 }
    );
  }
}
