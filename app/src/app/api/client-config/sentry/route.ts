import { NextResponse } from "next/server";
import { getSentryDsn } from "@/lib/sentry-gate";
import { parseRate } from "@/lib/sentry-scrub";

// SENTRY_* and SELF_HOSTED are set at runtime; the image is shared with self-hosted.
export const dynamic = "force-dynamic";

/** True unless the request comes from a host other than the main app (status subdomain or custom domain). */
function isMainAppHost(request: Request): boolean {
  const env = process.env;
  const appUrl = env.APP_URL || env.NEXT_PUBLIC_APP_URL || env.BETTER_AUTH_URL;
  if (!appUrl) return true;
  const host = (request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || "")
    .replace(/:\d+$/, "")
    .toLowerCase();
  try {
    return !host || host === "localhost" || host === "127.0.0.1" || host === new URL(appUrl).hostname.toLowerCase();
  } catch {
    return true;
  }
}

/**
 * GET /api/client-config/sentry
 * Browser Sentry config, read at runtime. `{}` when Sentry is off (no DSN,
 * self-hosted, or a public status-page host), so the client never loads the SDK
 * chunk there. The browser DSN is public by design. Imports no @sentry/* code.
 */
export async function GET(request: Request) {
  const dsn = getSentryDsn();
  const env = process.env;
  const body = dsn && isMainAppHost(request)
    ? {
        dsn,
        environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || "production",
        release: env.SENTRY_RELEASE?.trim() || env.NEXT_PUBLIC_SUPERCHECK_VERSION?.trim() || undefined,
        tracesSampleRate: parseRate(env.SENTRY_TRACES_SAMPLE_RATE),
        replaysSessionSampleRate: parseRate(env.SENTRY_REPLAY_SESSION_SAMPLE_RATE, 0),
        replaysOnErrorSampleRate: parseRate(env.SENTRY_REPLAY_ERROR_SAMPLE_RATE, 0),
      }
    : {};
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
