import { NextRequest, NextResponse } from "next/server";
import {
  getAllowedEmailDomains,
  isCloudHosted,
  isSignupEnabled,
  isStatusPageBrandingHidden,
} from "@/lib/feature-flags";
import {
  getStatusPageRuntimeConfig,
} from "@/lib/status-page-domain";

// This endpoint exposes runtime configuration sourced from environment
// variables. Force dynamic evaluation so Compose env changes are reflected
// without a rebuild.
export const dynamic = "force-dynamic";

/**
 * GET /api/config/app
 * Returns unified application configuration for runtime settings
 *
 * This endpoint consolidates all runtime configuration that would otherwise
 * require NEXT_PUBLIC_* environment variables (which are baked in at build time).
 * Using this endpoint allows configuration changes without rebuilding the app.
 */
export async function GET(request: NextRequest) {
  const cloudHosted = isCloudHosted();
  const statusPageRuntimeConfig = getStatusPageRuntimeConfig(
    request.headers.get("x-forwarded-host") || request.headers.get("host")
  );

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

    // Registration settings
    registration: {
      signupEnabled: isSignupEnabled(),
      allowedEmailDomains: getAllowedEmailDomains(),
    },

    // Demo mode flag
    demoMode: process.env.DEMO_MODE === "true",

    // Community links visibility (GitHub star, Discord invite)
    // Independent setting that can be controlled separately from demo/self-hosted mode
    showCommunityLinks: process.env.SHOW_COMMUNITY_LINKS === "true",

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

    // Status page configuration
    statusPage: {
      // Reserved domain namespace for default public status-page URLs.
      domain: statusPageRuntimeConfig.domain,
      // Primary target shown to users for custom-domain setup. This may differ
      // from the reserved namespace when deployments use a dedicated ingress
      // hostname such as cname.example.com.
      customDomainTarget: statusPageRuntimeConfig.customDomainTarget,
      hideBranding: isStatusPageBrandingHidden(),
    },
  });
}
