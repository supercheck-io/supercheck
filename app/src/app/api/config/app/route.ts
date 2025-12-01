import { NextResponse } from "next/server";
import { isCloudHosted } from "@/lib/feature-flags";

/**
 * GET /api/config/app
 * Returns unified application configuration for runtime settings
 *
 * This endpoint consolidates all runtime configuration that would otherwise
 * require NEXT_PUBLIC_* environment variables (which are baked in at build time).
 * Using this endpoint allows configuration changes without rebuilding the app.
 */
export async function GET() {
  const cloudHosted = isCloudHosted();

  return NextResponse.json({
    // Hosting mode
    hosting: {
      selfHosted: !cloudHosted,
      cloudHosted: cloudHosted,
    },

    // Authentication providers (enabled when credentials are configured)
    authProviders: {
      github: {
        enabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      },
      google: {
        enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      },
    },

    // Demo mode flag
    demoMode: process.env.DEMO_MODE === "true",

    // Application limits
    limits: {
      maxJobNotificationChannels: parseInt(
        process.env.MAX_JOB_NOTIFICATION_CHANNELS || "10",
        10
      ),
      maxMonitorNotificationChannels: parseInt(
        process.env.MAX_MONITOR_NOTIFICATION_CHANNELS || "10",
        10
      ),
      recentMonitorResultsLimit: process.env.RECENT_MONITOR_RESULTS_LIMIT
        ? parseInt(process.env.RECENT_MONITOR_RESULTS_LIMIT, 10)
        : undefined,
    },
  });
}
