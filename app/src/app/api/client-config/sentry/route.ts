import { NextResponse } from "next/server";
import { getSentryBrowserConfig } from "@/lib/sentry-client-config";

export const dynamic = "force-dynamic";

/**
 * GET /api/client-config/sentry
 * Browser Sentry config, read at runtime (see getSentryBrowserConfig). The app shell gets the same
 * value from the server layout; this route stays for clients that load without it.
 */
export async function GET(request: Request) {
  return NextResponse.json(getSentryBrowserConfig(request.headers), { headers: { "Cache-Control": "no-store" } });
}
