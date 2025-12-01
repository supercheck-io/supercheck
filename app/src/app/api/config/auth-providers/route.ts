import { NextResponse } from "next/server";

/**
 * GET /api/config/auth-providers
 * Returns which social authentication providers are enabled at runtime
 *
 * This endpoint allows runtime configuration of social auth providers.
 * A provider is considered enabled if both its client ID and secret are configured.
 */
export async function GET() {
  return NextResponse.json({
    github: {
      enabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    },
    google: {
      enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
  });
}
