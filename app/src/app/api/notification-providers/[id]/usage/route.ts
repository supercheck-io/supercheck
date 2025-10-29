import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { 
  monitorNotificationSettings,
  jobNotificationSettings
} from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    // Check if provider is in use by any monitors or jobs
    const [monitorUsage, jobUsage] = await Promise.all([
      db
        .select({ monitorId: monitorNotificationSettings.monitorId })
        .from(monitorNotificationSettings)
        .where(eq(monitorNotificationSettings.notificationProviderId, id)),
      db
        .select({ jobId: jobNotificationSettings.jobId })
        .from(jobNotificationSettings)
        .where(eq(jobNotificationSettings.notificationProviderId, id))
    ]);

    const isInUse = monitorUsage.length > 0 || jobUsage.length > 0;

    return NextResponse.json({
      isInUse,
      usage: {
        monitors: monitorUsage.length,
        jobs: jobUsage.length,
        details: {
          monitorIds: monitorUsage.map(m => m.monitorId),
          jobIds: jobUsage.map(j => j.jobId)
        }
      }
    });
  } catch (error) {
    console.error("Error checking notification provider usage:", error);
    return NextResponse.json(
      { error: "Failed to check provider usage" },
      { status: 500 }
    );
  }
} 