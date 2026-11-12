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
import {
  scrubEvent,
  scrubName,
  scrubSpan,
  scrubString,
  scrubTransaction,
  scrubUrl,
} from "@/lib/sentry-scrub";

/** Scrubs URLs and text inside replay custom frames (navigation, resource and breadcrumb payloads). */
function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return /^(https?:\/\/|\/)/i.test(value)
      ? scrubUrl(value)
      : scrubString(scrubName(value));
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
  // Billing lives under org admin (/billing redirects to its subscription tab); member lists show emails.
  "/org-admin",
];

export function isExcludedPath(pathname: string): boolean {
  return EXCLUDED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Checked on every send: the SDK stays loaded after client-side navigation to an excluded page.
const onExcludedPage = () =>
  typeof window !== "undefined" && isExcludedPath(window.location.pathname);

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
let loadAttempts = 0;
const MAX_LOAD_ATTEMPTS = 3;

/** Tests only: forgets the per-page-load SDK state. */
export function resetSentryBrowserForTest(): void {
  sdkPromise = null;
  loadAttempts = 0;
}

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
    beforeSend: (event) => (onExcludedPage() ? null : scrubEvent(event)),
    beforeSendTransaction: (event) =>
      onExcludedPage() ? null : scrubTransaction(event),
    // Standalone spans (INP) skip beforeSendTransaction; the hook cannot drop them, so their name is scrubbed.
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
              // INP is sent as a standalone span that beforeSendSpan cannot drop on excluded pages.
              enableInp: false,
              beforeStartSpan: (options) => ({
                ...options,
                name: scrubName(options.name),
              }),
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
              maskAttributes: [
                "title",
                "placeholder",
                "aria-label",
                "href",
                "src",
                "srcset",
                "alt",
                "value",
              ],
              // Custom frames (navigation, resources, breadcrumbs) carry URLs with query strings.
              beforeAddRecordingEvent: (event) => {
                if (
                  event.type === 5 &&
                  "data" in event &&
                  event.data &&
                  typeof event.data === "object"
                ) {
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
    if (onExcludedPage()) return null;
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
      void sdkPromise
        ?.then((s) => s?.getReplay()?.stop())
        .catch(() => undefined);
      return;
    }
    // A failed config fetch is retried on later navigations, at most MAX_LOAD_ATTEMPTS times per page load.
    if (!sdkPromise && loadAttempts < MAX_LOAD_ATTEMPTS) {
      loadAttempts++;
      sdkPromise = loadSentry().catch(() => {
        sdkPromise = null;
        return null;
      });
    }
    void sdkPromise
      ?.then((s) => s?.setUser(userId ? { id: userId } : null))
      // shortcut: a replay stopped on an excluded page is not resumed when the user comes back
      // (a manual start() would ignore the sample rates); the next full page load samples again.
      .catch(() => undefined);
  }, [excluded, userId]);

  return null;
}
