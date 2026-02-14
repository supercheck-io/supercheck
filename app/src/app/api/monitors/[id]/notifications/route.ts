import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import {
  monitorNotificationSettings,
  notificationProviders,
  monitors,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  hasPermissionForUser,
} from "@/lib/rbac/middleware";
import { requireUserAuthContext } from "@/lib/auth-context";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { id } = params;
  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 }
    );
  }

  try {
    // Require authentication (supports both Bearer tokens and session cookies)
    const { userId } = await requireUserAuthContext();

    // Get monitor to check permissions
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
      columns: { organizationId: true, projectId: true },
    });

    if (!monitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    // Check if user has permission to view this monitor's notifications
    const canView = await hasPermissionForUser(userId, "monitor", "view", {
      organizationId: monitor.organizationId || undefined,
      projectId: monitor.projectId || undefined,
    });

    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions to view monitor notifications" },
        { status: 403 }
      );
    }

    // Get all notification providers linked to this monitor
    // SECURITY: Do NOT return provider config (contains encrypted secrets)
    const linkedProviders = await db
      .select({
        providerId: monitorNotificationSettings.notificationProviderId,
        providerType: notificationProviders.type,
        providerName: notificationProviders.name,
        createdAt: monitorNotificationSettings.createdAt,
      })
      .from(monitorNotificationSettings)
      .innerJoin(
        notificationProviders,
        eq(
          monitorNotificationSettings.notificationProviderId,
          notificationProviders.id
        )
      )
      .where(eq(monitorNotificationSettings.monitorId, id));

    return NextResponse.json(linkedProviders);
  } catch (error) {
    console.error(
      `Error fetching notification settings for monitor ${id}:`,
      error
    );
    return NextResponse.json(
      { error: "Failed to fetch notification settings" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { id } = params;
  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 }
    );
  }

  try {
    // Require authentication (supports both Bearer tokens and session cookies)
    const { userId } = await requireUserAuthContext();

    // Get monitor to check permissions
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
      columns: { organizationId: true, projectId: true },
    });

    if (!monitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    // Check if user has permission to update monitor notifications
    const canUpdate = await hasPermissionForUser(userId, "monitor", "update", {
      organizationId: monitor.organizationId || undefined,
      projectId: monitor.projectId || undefined,
    });

    if (!canUpdate) {
      return NextResponse.json(
        { error: "Insufficient permissions to update monitor notifications" },
        { status: 403 }
      );
    }

    const { notificationProviderId } = await request.json();

    if (!notificationProviderId) {
      return NextResponse.json(
        { error: "Notification provider ID is required" },
        { status: 400 }
      );
    }

    // SECURITY: Validate that the notification provider belongs to the same org/project as the monitor
    const provider = await db.query.notificationProviders.findFirst({
      where: and(
        eq(notificationProviders.id, notificationProviderId),
        eq(notificationProviders.organizationId, monitor.organizationId || ""),
        eq(notificationProviders.projectId, monitor.projectId || "")
      ),
      columns: { id: true },
    });

    if (!provider) {
      return NextResponse.json(
        { error: "Notification provider not found or does not belong to this project" },
        { status: 404 }
      );
    }

    // Check if the link already exists
    const existingLink = await db.query.monitorNotificationSettings.findFirst({
      where: and(
        eq(monitorNotificationSettings.monitorId, id),
        eq(
          monitorNotificationSettings.notificationProviderId,
          notificationProviderId
        )
      ),
    });

    if (existingLink) {
      return NextResponse.json(
        { error: "Monitor is already linked to this notification provider" },
        { status: 409 }
      );
    }

    // Create the link
    const [newLink] = await db
      .insert(monitorNotificationSettings)
      .values({
        monitorId: id,
        notificationProviderId,
      })
      .returning();

    return NextResponse.json(newLink, { status: 201 });
  } catch (error) {
    console.error(
      `Error linking notification provider to monitor ${id}:`,
      error
    );
    return NextResponse.json(
      { error: "Failed to link notification provider" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { id } = params;
  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 }
    );
  }

  try {
    // Require authentication (supports both Bearer tokens and session cookies)
    const { userId } = await requireUserAuthContext();

    // Get monitor to check permissions
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
      columns: { organizationId: true, projectId: true },
    });

    if (!monitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    // Check if user has permission to update monitor notifications
    const canUpdate = await hasPermissionForUser(userId, "monitor", "update", {
      organizationId: monitor.organizationId || undefined,
      projectId: monitor.projectId || undefined,
    });

    if (!canUpdate) {
      return NextResponse.json(
        { error: "Insufficient permissions to update monitor notifications" },
        { status: 403 }
      );
    }

    const { notificationProviderId } = await request.json();

    if (!notificationProviderId) {
      return NextResponse.json(
        { error: "Notification provider ID is required" },
        { status: 400 }
      );
    }

    // Remove the link
    const [deletedLink] = await db
      .delete(monitorNotificationSettings)
      .where(
        and(
          eq(monitorNotificationSettings.monitorId, id),
          eq(
            monitorNotificationSettings.notificationProviderId,
            notificationProviderId
          )
        )
      )
      .returning();

    if (!deletedLink) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(
      `Error unlinking notification provider from monitor ${id}:`,
      error
    );
    return NextResponse.json(
      { error: "Failed to unlink notification provider" },
      { status: 500 }
    );
  }
}
