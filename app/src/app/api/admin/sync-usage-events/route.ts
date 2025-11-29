import { NextRequest, NextResponse } from "next/server";
import { polarUsageService } from "@/lib/services/polar-usage.service";
import { isPolarEnabled } from "@/lib/feature-flags";

/**
 * Sync pending usage events to Polar
 * 
 * This endpoint should be called periodically (e.g., every 5 minutes) via a cron job
 * to sync usage events from the local database to Polar for billing.
 * 
 * Authentication: Requires CRON_SECRET header for cron jobs, or admin session
 * 
 * Example cron setup (Vercel, Railway, etc.):
 * POST /api/admin/sync-usage-events
 * Header: x-cron-secret: YOUR_CRON_SECRET
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret for automated calls
    const cronSecret = request.headers.get("x-cron-secret");
    const expectedSecret = process.env.CRON_SECRET;
    
    // Allow access if:
    // 1. Cron secret matches, OR
    // 2. No cron secret is set (for testing)
    if (expectedSecret && cronSecret !== expectedSecret) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!isPolarEnabled()) {
      return NextResponse.json({
        success: true,
        message: "Polar is not enabled - skipping sync",
        processed: 0,
        succeeded: 0,
        failed: 0,
      });
    }

    // Sync pending events (default batch size: 50)
    const result = await polarUsageService.syncPendingEvents(50);

    console.log(`[Cron] Usage sync completed: ${result.succeeded}/${result.processed} events synced`);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[Cron] Usage sync error:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for manual triggering or health checks
 */
export async function GET(request: NextRequest) {
  // Check if this is a health check
  const isHealthCheck = request.nextUrl.searchParams.get("health") === "true";
  
  if (isHealthCheck) {
    return NextResponse.json({
      status: "ok",
      polarEnabled: isPolarEnabled(),
      endpoint: "/api/admin/sync-usage-events",
    });
  }

  // Redirect to POST for actual sync
  return NextResponse.json({
    message: "Use POST method to sync usage events",
    endpoint: "/api/admin/sync-usage-events",
    method: "POST",
    headers: {
      "x-cron-secret": "YOUR_CRON_SECRET (if CRON_SECRET env var is set)",
    },
  });
}
