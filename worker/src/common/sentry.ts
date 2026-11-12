/**
 * Sentry (worker), Supercheck Cloud only: errors, logs, traces, cron check-ins
 * and metrics.
 *
 * Runtime env only (the Docker image is shared with self-hosted):
 * SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_RELEASE, SENTRY_TRACES_SAMPLE_RATE,
 * SENTRY_ENABLE_LOGS. Ignored when SELF_HOSTED is true.
 *
 * This module imports the SDK. Production code must go through
 * ./sentry-reporter (or the ../instrument preload), which checks the gate in
 * ./sentry-gate and only then requires this module, so a disabled or
 * self-hosted worker never loads @sentry/*.
 *
 * Uses @sentry/node 10.x: 11.x pulls build tooling and a source-available (FSL)
 * package into production dependencies. Scrubbing lives in ./sentry-scrub.
 */
import * as Sentry from '@sentry/node';
import { getServiceVersion } from './version';
import { getSentryDsn } from './sentry-gate';
import {
  isUnsampledPath,
  parseRate,
  scrubEvent,
  scrubLog,
  scrubMetric,
  scrubTransaction,
} from './sentry-scrub';

export { scrubEvent, scrubString } from './sentry-scrub';

// Default integrations that capture console output, HTTP data, local variables,
// source lines, module lists, child processes or session telemetry. Http and
// NodeFetch are re-added below for incoming spans only.
const DROPPED_INTEGRATIONS = new Set([
  'Console',
  'RequestData',
  'LocalVariablesAsync',
  'ContextLines',
  'Modules',
  'ChildProcess',
  'Http',
  'NodeFetch',
  'ProcessSession',
  'OnUnhandledRejection', // re-added below in strict mode
]);

/** Returns Sentry options, or null when Sentry must stay completely off. */
export function getSentryOptions(
  env: Record<string, string | undefined> = process.env,
  selfHosted?: boolean,
): Sentry.NodeOptions | null {
  const dsn = getSentryDsn(env, selfHosted);
  if (!dsn) return null;
  const tracesRate = parseRate(env.SENTRY_TRACES_SAMPLE_RATE);
  const logs = env.SENTRY_ENABLE_LOGS?.trim().toLowerCase() === 'true';
  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || 'production',
    release: env.SENTRY_RELEASE?.trim() || getServiceVersion(),
    sendDefaultPii: false,
    includeLocalVariables: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    initialScope: { tags: { service: 'worker' } },
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubTransaction,
    // Without a rate, tracing stays fully off (no sampler means no span instrumentation).
    tracesSampler:
      tracesRate > 0
        ? (ctx) =>
            isUnsampledPath(ctx.name) ||
            isUnsampledPath(ctx.normalizedRequest?.url)
              ? 0
              : ctx.inheritOrSampleWith(tracesRate)
        : undefined,
    // No outgoing trace headers (outgoing requests are ignored below).
    tracePropagationTargets: [],
    enableLogs: logs,
    beforeSendLog: scrubLog,
    enableMetrics: true,
    beforeSendMetric: scrubMetric,
    integrations: (defaults) => [
      ...defaults.filter((i) => !DROPPED_INTEGRATIONS.has(i.name)),
      // strict keeps Node's default: an unhandled rejection still terminates the process.
      Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
      // Incoming spans only. Outgoing requests are monitor checks, notifications and
      // private agents (customer hosts), so they never become spans.
      Sentry.httpIntegration({
        breadcrumbs: false,
        ignoreOutgoingRequests: () => true,
        trackIncomingRequestsAsSessions: false,
        ignoreIncomingRequestBody: () => true,
      }),
      Sentry.nativeNodeFetchIntegration({
        breadcrumbs: false,
        ignoreOutgoingRequests: () => true,
      }),
      ...(logs
        ? [
            Sentry.pinoIntegration({
              log: { levels: ['info', 'warn', 'error', 'fatal'] },
              error: { levels: [] },
            }),
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

function jobTags(
  job: { id?: string; queueName?: string; data?: unknown } | undefined,
): Record<string, string> {
  const data = (job?.data ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const tags: Record<string, string> = {};
  const candidates = {
    jobId: str(job?.id),
    queue: str(job?.queueName),
    runId: str(data.runId),
    organizationId: str(data.organizationId),
    projectId: str(data.projectId),
  };
  for (const [k, v] of Object.entries(candidates)) if (v) tags[k] = v;
  return tags;
}

/** Reports a failed job by ID tags only; never reads script, variables or logs from job.data. */
export function reportJobFailure(
  job: { id?: string; queueName?: string; data?: unknown } | undefined,
  error: Error,
): void {
  Sentry.captureException(error, { tags: jobTags(job) });
}

/**
 * Runs a queue job as its own transaction, continuing the app's trace when the
 * job carries `_trace` (set by the app when it enqueues). Records queue wait and
 * duration metrics with enum/ID attributes only.
 */
export async function runJobInSpan<T>(
  job: {
    id?: string;
    queueName?: string;
    data?: unknown;
    timestamp?: number;
    attemptsMade?: number;
  },
  type: string,
  fn: () => Promise<T>,
): Promise<T> {
  const data = (job.data ?? {}) as Record<string, unknown>;
  const trace = (data._trace ?? {}) as Record<string, unknown>;
  const tags = jobTags(job);
  const attributes = { type, queue: tags.queue ?? type };
  // Metrics are best effort: they must never change a job's outcome.
  const metric = (
    name: string,
    value: number,
    attrs: Record<string, string>,
  ) => {
    try {
      Sentry.metrics.distribution(name, value, {
        unit: 'millisecond',
        attributes: attrs,
      });
    } catch {
      // ignore
    }
  };
  // Queue wait only on the first attempt; retries and delayed re-entries would inflate it.
  if (typeof job.timestamp === 'number' && !job.attemptsMade) {
    metric(
      'run.queue_wait',
      Math.max(0, Date.now() - job.timestamp),
      attributes,
    );
  }
  const started = Date.now();
  let status = 'ok';
  try {
    return await Sentry.continueTrace(
      {
        sentryTrace:
          typeof trace.sentryTrace === 'string' ? trace.sentryTrace : undefined,
        baggage: typeof trace.baggage === 'string' ? trace.baggage : undefined,
      },
      () =>
        Sentry.startSpan(
          {
            name: `${type} run`,
            op: 'queue.process',
            forceTransaction: true,
            attributes: tags,
          },
          fn,
        ),
    );
  } catch (error) {
    // DelayedError is BullMQ's "reschedule me", not a failure.
    status = (error as Error)?.name === 'DelayedError' ? 'delayed' : 'error';
    throw error;
  } finally {
    metric('run.duration', Date.now() - started, { ...attributes, status });
  }
}

export function countMetric(
  name: string,
  attributes: Record<string, string | number | boolean>,
): void {
  Sentry.metrics.count(name, 1, { attributes });
}

/** Flushes queued events, waiting at most `timeoutMs`. */
export async function closeSentry(timeoutMs = 2000): Promise<void> {
  await Sentry.close(timeoutMs);
}
