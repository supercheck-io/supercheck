import { getSentryDsn } from "@/lib/sentry-gate";
import { parseRate } from "@/lib/sentry-scrub";

/** Browser Sentry options; empty when Sentry is off for this host. The browser DSN is public by design. */
export type SentryBrowserConfig = {
  dsn?: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
  replaysSessionSampleRate?: number;
  replaysOnErrorSampleRate?: number;
};

/** True unless the request comes from a host other than the main app (status subdomain or custom domain). */
function isMainAppHost(headers: Headers): boolean {
  const env = process.env;
  const appUrl = env.APP_URL || env.NEXT_PUBLIC_APP_URL || env.BETTER_AUTH_URL;
  if (!appUrl) return true;
  const host = (headers.get("x-forwarded-host")?.split(",")[0].trim() || headers.get("host") || "")
    .replace(/:\d+$/, "")
    .toLowerCase();
  try {
    return !host || host === "localhost" || host === "127.0.0.1" || host === new URL(appUrl).hostname.toLowerCase();
  } catch {
    return true;
  }
}

/**
 * Browser Sentry config for a request. `{}` when Sentry is off (no DSN, self-hosted, or a public
 * status-page host), so the client never loads the SDK there. Imports no @sentry/* code.
 */
export function getSentryBrowserConfig(headers: Headers): SentryBrowserConfig {
  const dsn = getSentryDsn();
  const env = process.env;
  return dsn && isMainAppHost(headers)
    ? {
        dsn,
        environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || "production",
        release: env.SENTRY_RELEASE?.trim() || env.NEXT_PUBLIC_SUPERCHECK_VERSION?.trim() || undefined,
        tracesSampleRate: parseRate(env.SENTRY_TRACES_SAMPLE_RATE),
        replaysSessionSampleRate: parseRate(env.SENTRY_REPLAY_SESSION_SAMPLE_RATE, 0),
        replaysOnErrorSampleRate: parseRate(env.SENTRY_REPLAY_ERROR_SAMPLE_RATE, 0),
      }
    : {};
}
