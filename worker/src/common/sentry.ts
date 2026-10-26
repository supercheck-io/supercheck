/**
 * Sentry error monitoring (server-side only), Supercheck Cloud only.
 *
 * Runtime env only (the Docker image is shared with self-hosted):
 * SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_RELEASE. Ignored when SELF_HOSTED is true.
 *
 * Keep scrubbing logic in sync with app/src/lib/sentry.ts.
 */
import * as Sentry from '@sentry/node';
import { getServiceVersion } from './version';

const isSelfHostedEnv = (env: Record<string, string | undefined>): boolean =>
  ['true', '1'].includes(env.SELF_HOSTED?.trim().toLowerCase() ?? '');

const MAX_LENGTH = 500;
const ALLOWED_TAGS = new Set([
  'organizationId',
  'projectId',
  'runId',
  'jobId',
  'queue',
  'service',
]);
const ALLOWED_CONTEXTS = new Set(['runtime', 'os']);
// Integrations that capture console output, HTTP bodies/headers or local variables.
const DROPPED_INTEGRATIONS = new Set([
  'Console',
  'RequestData',
  'LocalVariables',
  'Http',
  'NodeFetch',
  'Undici',
]);

const REDACTIONS: Array<[RegExp, string]> = [
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi, '[url]'], // URLs and connection strings
  [/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer [redacted]'],
  [
    /\b([\w-]*(?:key|token|secret|passw(?:or)?d|pwd|auth|cookie|session)[\w-]*)\s*[=:]\s*[^\s,;&]+/gi,
    '$1=[redacted]',
  ],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  [/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]'], // long opaque tokens
];

export function scrubString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out.length > MAX_LENGTH ? `${out.slice(0, MAX_LENGTH)}...` : out;
}

/** Shared beforeSend: keeps error type/message (scrubbed), stack, release, allow-listed IDs. */
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  delete event.request;
  delete event.extra;
  delete event.breadcrumbs;
  delete event.server_name;
  delete event.modules;

  if (event.user?.id) event.user = { id: String(event.user.id) };
  else delete event.user;

  if (event.contexts) {
    for (const key of Object.keys(event.contexts)) {
      if (!ALLOWED_CONTEXTS.has(key)) delete event.contexts[key];
    }
  }

  if (event.tags) {
    for (const key of Object.keys(event.tags)) {
      if (!ALLOWED_TAGS.has(key)) delete event.tags[key];
    }
  }

  if (event.message) event.message = scrubString(event.message);
  if (event.logentry)
    event.logentry = { message: scrubString(event.logentry.message ?? '') };
  if (event.transaction) event.transaction = event.transaction.split('?')[0];

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubString(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
      delete frame.pre_context;
      delete frame.context_line;
      delete frame.post_context;
    }
  }
  return event;
}

/** Returns Sentry options, or null when Sentry must stay completely off. */
export function getSentryOptions(
  env: Record<string, string | undefined> = process.env,
  selfHosted: boolean = isSelfHostedEnv(env),
): Sentry.NodeOptions | null {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn || selfHosted) return null;
  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || 'production',
    release: env.SENTRY_RELEASE?.trim() || getServiceVersion(),
    // Sentry v11 replaced sendDefaultPii with dataCollection; everything off.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    // No tracesSampleRate / profiles / replay: tracing and profiling stay off.
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: scrubEvent,
    integrations: (defaults) =>
      defaults.filter((i) => !DROPPED_INTEGRATIONS.has(i.name)),
  };
}

export function initSentry(): boolean {
  const options = getSentryOptions();
  if (!options) return false;
  Sentry.init(options);
  return true;
}

/** Reports a failed job by ID tags only; never reads script, variables or logs from job.data. */
export function captureJobFailure(
  job: { id?: string; queueName?: string; data?: unknown } | undefined,
  error: Error,
): void {
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
  Sentry.captureException(error, { tags });
}
