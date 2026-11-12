/**
 * Sentry (server side), Supercheck Cloud only: errors, logs, traces, cron
 * check-ins and metrics.
 *
 * Runtime env only (the Docker image is shared with self-hosted):
 * SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_RELEASE, SENTRY_TRACES_SAMPLE_RATE,
 * SENTRY_ENABLE_LOGS. Ignored when SELF_HOSTED is true.
 *
 * This module imports the SDK. Callers must check getSentryDsn() from
 * ./sentry-gate first (or go through ./sentry-lazy), so a disabled or
 * self-hosted deployment never loads @sentry/*.
 *
 * Uses @sentry/node (not @sentry/nextjs): the Next.js SDK pulls build tooling and
 * a source-available (FSL) package into production dependencies.
 * Scrubbing rules live in ./sentry-scrub (shared with the browser SDK).
 */
import * as Sentry from "@sentry/node";
import { getSentryDsn } from "@/lib/sentry-gate";
import {
  isUnsampledPath,
  parseRate,
  scrubEvent,
  scrubLog,
  scrubMetric,
  scrubTransaction,
} from "@/lib/sentry-scrub";

export { scrubEvent, scrubString } from "@/lib/sentry-scrub";

// Default integrations that capture console output, HTTP data, local variables,
// source lines, module lists, child processes or session telemetry. Http and
// NodeFetch are re-added below with breadcrumbs off.
const DROPPED_INTEGRATIONS = new Set([
  "Console",
  "RequestData",
  "LocalVariablesAsync",
  "ContextLines",
  "Modules",
  "ChildProcess",
  "Http",
  "NodeFetch",
  "ProcessSession",
  "OnUnhandledRejection", // re-added below in warn mode
]);

export function getRelease(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.SENTRY_RELEASE?.trim() || env.NEXT_PUBLIC_SUPERCHECK_VERSION?.trim() || undefined;
}

export function getEnvironment(env: Record<string, string | undefined> = process.env): string {
  return env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || "production";
}

/** Returns Sentry options, or null when Sentry must stay completely off. */
export function getSentryOptions(
  env: Record<string, string | undefined> = process.env,
  selfHosted?: boolean,
): Sentry.NodeOptions | null {
  const dsn = getSentryDsn(env, selfHosted);
  if (!dsn) return null;
  const tracesRate = parseRate(env.SENTRY_TRACES_SAMPLE_RATE);
  const logs = env.SENTRY_ENABLE_LOGS?.trim().toLowerCase() === "true";
  return {
    dsn,
    environment: getEnvironment(env),
    release: getRelease(env),
    sendDefaultPii: false,
    includeLocalVariables: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    initialScope: { tags: { service: "app" } },
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubTransaction,
    // Without a rate, tracing stays fully off (no sampler means no span instrumentation).
    tracesSampler:
      tracesRate > 0
        ? (ctx) =>
            isUnsampledPath(ctx.name) || isUnsampledPath(ctx.normalizedRequest?.url)
              ? 0
              : ctx.inheritOrSampleWith(tracesRate)
        : undefined,
    // No outgoing trace headers: the worker gets the trace through job data, and every
    // other outgoing request may reach a customer or third-party endpoint.
    tracePropagationTargets: [],
    enableLogs: logs,
    beforeSendLog: scrubLog,
    enableMetrics: true,
    beforeSendMetric: scrubMetric,
    integrations: (defaults) => [
      ...defaults.filter((i) => !DROPPED_INTEGRATIONS.has(i.name)),
      // warn, not strict: Next registers its own log-only unhandledRejection listener, so the app survives
      // stray rejections today; strict would exit the pod. The worker, which has no such listener, uses strict.
      Sentry.onUnhandledRejectionIntegration({ mode: "warn" }),
      // Spans only; customer hosts and paths are rewritten by scrubTransaction.
      Sentry.httpIntegration({
        breadcrumbs: false,
        trackIncomingRequestsAsSessions: false,
        ignoreIncomingRequestBody: () => true,
      }),
      Sentry.nativeNodeFetchIntegration({ breadcrumbs: false }),
      ...(logs
        ? [
            Sentry.pinoIntegration({ log: { levels: ["warn", "error", "fatal"] }, error: { levels: [] } }),
            Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
          ]
        : []),
    ],
  };
}

export function initSentry(): boolean {
  if (Sentry.isInitialized()) return true;
  const options = getSentryOptions();
  if (!options) return false;
  Sentry.init(options);
  return true;
}

/** Reports an unhandled request error without attaching the request. */
export function captureRequestError(error: unknown): void {
  Sentry.captureException(error);
}

/** sentry-trace and baggage for the active span, to continue the trace in the worker. */
export function getTraceHeaders(): { sentryTrace?: string; baggage?: string } {
  const data = Sentry.getTraceData();
  return { sentryTrace: data["sentry-trace"], baggage: data.baggage };
}

export type CronSchedule = { type: "interval"; value: number; unit: "minute" | "hour" } | { type: "crontab"; value: string };

/** One completed check-in (no in_progress); the monitor is upserted from the schedule. */
export function captureCheckIn(slug: string, schedule: CronSchedule, status: "ok" | "error", durationSeconds: number): void {
  Sentry.captureCheckIn(
    { monitorSlug: slug, status, duration: durationSeconds },
    { schedule, checkinMargin: 2, maxRuntime: 30, failureIssueThreshold: 2, recoveryThreshold: 1 },
  );
}

/**
 * Flushes queued events on SIGTERM. Never terminates the process itself: Next and the queue
 * shutdown handlers own exit, and the pod's grace period covers the rest.
 */
export function flushOnSigterm(): void {
  process.once("SIGTERM", () => {
    void Sentry.close(2000).catch(() => undefined);
  });
}
