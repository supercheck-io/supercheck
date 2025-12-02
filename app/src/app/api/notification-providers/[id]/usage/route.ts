import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import {
  monitorNotificationSettings,
  jobNotificationSettings,
  notificationProviders,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { hasPermission } from "@/lib/rbac/middleware";
import { requireProjectContext } from "@/lib/project-context";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { project, organizationId } = await requireProjectContext();

    // Check permission to view notification providers
    const canView = await hasPermission("monitor", "view", {
      organizationId,
      projectId: project.id,
    });

    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Verify the provider belongs to this organization and project
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
        .where(eq(monitorNotificationSettings.notificationProviderId, id)),
      db
        .select({ jobId: jobNotificationSettings.jobId })
        .from(jobNotificationSettings)
        .where(eq(jobNotificationSettings.notificationProviderId, id)),
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
    console.error("Error checking notification provider usage:", error);
    return NextResponse.json(
      { error: "Failed to check provider usage" },
      { status: 500 }
    );
  }
}
