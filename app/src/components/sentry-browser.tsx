"use client";

/**
 * Browser Sentry (errors, traces, session replay), Supercheck Cloud only.
 *
 * Config comes from /api/client-config/sentry at runtime (the image is shared
 * with self-hosted, so NEXT_PUBLIC values can't carry it). The SDK chunk is
 * imported only after that route returns a DSN, so self-hosted and status-page
 * hosts never fetch it. Scrubbing rules are shared with the server SDK.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/utils/auth-client";
import { scrubEvent, scrubName, scrubSpan, scrubString, scrubTransaction, scrubUrl } from "@/lib/sentry-scrub";

/** Scrubs URLs and text inside replay custom frames (navigation, resource and breadcrumb payloads). */
function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return /^(https?:\/\/|\/)/i.test(value) ? scrubUrl(value) : scrubString(scrubName(value));
  }
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = scrubDeep(v, depth + 1);
  return out;
}

// Public, auth and billing pages: no SDK and no replay there.
const EXCLUDED = [
  "/status",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/invite",
  "/oauth",
  "/device",
  "/billing",
  "/subscribe",
];

export function isExcludedPath(pathname: string): boolean {
  return EXCLUDED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

type BrowserConfig = {
  dsn?: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
  replaysSessionSampleRate?: number;
  replaysOnErrorSampleRate?: number;
};
type SentryReact = typeof import("@sentry/react");

let sdkPromise: Promise<SentryReact | null> | null = null;

async function loadSentry(): Promise<SentryReact | null> {
  const res = await fetch("/api/client-config/sentry", { cache: "no-store" });
  const config = (await res.json()) as BrowserConfig;
  if (!config.dsn) return null;
  const Sentry = await import("@sentry/react");
  const traces = config.tracesSampleRate ?? 0;
  const replaySession = config.replaysSessionSampleRate ?? 0;
  const replayError = config.replaysOnErrorSampleRate ?? 0;
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubTransaction,
    // Standalone spans (INP) skip beforeSendTransaction.
    beforeSendSpan: (span) => scrubSpan(span),
    tracesSampleRate: traces > 0 ? traces : undefined,
    // Trace headers only on same-origin requests.
    tracePropagationTargets: [/^\//],
    replaysSessionSampleRate: replaySession,
    replaysOnErrorSampleRate: replayError,
    initialScope: { tags: { service: "browser" } },
    integrations: [
      ...(traces > 0
        ? [
            Sentry.browserTracingIntegration({
              beforeStartSpan: (options) => ({ ...options, name: scrubName(options.name) }),
            }),
          ]
        : []),
      ...(replaySession > 0 || replayError > 0
        ? [
            Sentry.replayIntegration({
              maskAllText: true,
              maskAllInputs: true,
              blockAllMedia: true,
              block: ["[data-sentry-block]", "iframe"],
              networkDetailAllowUrls: [],
              networkCaptureBodies: false,
              // The defaults plus link and media targets (customer URLs in href/src).
              maskAttributes: ["title", "placeholder", "aria-label", "href", "src", "srcset", "alt", "value"],
              // Custom frames (navigation, resources, breadcrumbs) carry URLs with query strings.
              beforeAddRecordingEvent: (event) => {
                if (event.type === 5 && "data" in event && event.data && typeof event.data === "object") {
                  const data = event.data as { payload?: unknown };
                  data.payload = scrubDeep(data.payload);
                }
                return event;
              },
            }),
          ]
        : []),
    ],
  });
  // Replay events skip beforeSend: scrub their URL list here.
  Sentry.addEventProcessor((event) => {
    if (event.type === "replay_event") {
      const replay = event as { urls?: string[]; request?: unknown };
      replay.urls = replay.urls?.map(scrubUrl);
      delete replay.request;
    }
    return event;
  });
  return Sentry;
}

export function SentryBrowser() {
  const pathname = usePathname();
  const userId = useSession().data?.user.id;
  const excluded = isExcludedPath(pathname ?? "");

  useEffect(() => {
    if (excluded) {
      // Leaving the app shell for an excluded page stops any running replay.
      void sdkPromise?.then((s) => s?.getReplay()?.stop()).catch(() => undefined);
      return;
    }
    sdkPromise ??= loadSentry().catch(() => null);
    void sdkPromise
      // shortcut: a replay stopped on an excluded page is not resumed when the user comes back
      // (a manual start() would ignore the sample rates); the next full page load samples again.
      .then((s) => s?.setUser(userId ? { id: userId } : null))
      .catch(() => undefined);
  }, [excluded, userId]);

  return null;
}
