import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { monitorNotificationSettings, notificationProviders } from "@/db/schema";
import { eq, and } from "drizzle-orm";

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
    // Get all notification providers linked to this monitor
    const linkedProviders = await db
      .select({
        providerId: monitorNotificationSettings.notificationProviderId,
        providerType: notificationProviders.type,
        providerConfig: notificationProviders.config,
        createdAt: monitorNotificationSettings.createdAt,
      })
      .from(monitorNotificationSettings)
      .innerJoin(
        notificationProviders,
        eq(monitorNotificationSettings.notificationProviderId, notificationProviders.id)
      )
      .where(eq(monitorNotificationSettings.monitorId, id));

    return NextResponse.json(linkedProviders);
  } catch (error) {
    console.error(`Error fetching notification settings for monitor ${id}:`, error);
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
    return NextResponse.json({ error: "Monitor ID is required" }, { status: 400 });
  }

  try {
    const { notificationProviderId } = await request.json();
    
    if (!notificationProviderId) {
      return NextResponse.json(
        { error: "Notification provider ID is required" },
        { status: 400 }
      );
    }

    // Check if the link already exists
    const existingLink = await db.query.monitorNotificationSettings.findFirst({
      where: and(
        eq(monitorNotificationSettings.monitorId, id),
        eq(monitorNotificationSettings.notificationProviderId, notificationProviderId)
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
    console.error(`Error linking notification provider to monitor ${id}:`, error);
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
    return NextResponse.json({ error: "Monitor ID is required" }, { status: 400 });
  }

  try {
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
          eq(monitorNotificationSettings.notificationProviderId, notificationProviderId)
        )
      )
      .returning();

    if (!deletedLink) {
      return NextResponse.json(
        { error: "Link not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`Error unlinking notification provider from monitor ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to unlink notification provider" },
      { status: 500 }
    );
  }
} 