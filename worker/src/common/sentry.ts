/**
 * Sentry error monitoring (server-side only), Supercheck Cloud only.
 *
 * Runtime env only (the Docker image is shared with self-hosted):
 * SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_RELEASE. Ignored when SELF_HOSTED is true.
 *
 * This module imports the SDK. Production code must go through
 * ./sentry-reporter, which checks the gate in ./sentry-gate and only then
 * requires this module, so a disabled or self-hosted worker never loads @sentry/*.
 *
 * Uses @sentry/node 10.x: 11.x pulls build tooling and a source-available (FSL)
 * package into production dependencies.
 *
 * Keep scrubbing logic in sync with app/src/lib/sentry.ts.
 */
import * as Sentry from '@sentry/node';
import { getServiceVersion } from './version';
import { getSentryDsn } from './sentry-gate';

const MAX_LENGTH = 500;
const MAX_SQL_LENGTH = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_TAGS = new Set([
  'organizationId',
  'projectId',
  'runId',
  'jobId',
  'queue',
]);
const ALLOWED_CONTEXTS = new Set(['runtime', 'os']);
// Default integrations that capture console output, HTTP data, local variables,
// source lines, module lists, child processes or session telemetry.
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

// Every pattern is linear: input is truncated first and no quantifiers nest or
// overlap (key prefixes/suffixes and URL schemes are length-bounded).
const REDACTIONS: Array<[RegExp, string | ((m: string) => string)]> = [
  // Quoted literals (selectors, expected text, JSON keys/values, code); an unterminated one runs to the end.
  [/"[^"]*(?:"|$)|`[^`]*(?:`|$)|(?<!\w)'[^']*(?:'|$)/g, '[text]'],
  // Whole header value: covers Basic/Bearer/custom schemes and cookie lists.
  [
    /\b(authorization|proxy-authorization|set-cookie|cookie)[ \t]*[:=][^\r\n]*/gi,
    '$1: [redacted]',
  ],
  [/\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s<>]+/gi, '[url]'], // URLs and connection strings
  [/\bBearer[ \t]+[\w.~+/=-]+/gi, 'Bearer [redacted]'],
  [/\bBasic[ \t]+[A-Za-z0-9+/=]{8,}/g, 'Basic [redacted]'],
  [
    /\b([\w-]{0,40}(?:key|token|secret|passw(?:or)?d|pwd|auth|cookie|session)[\w-]{0,40})["']?[ \t]*[=:][ \t]*[^\s,;&]+/gi,
    '$1=[redacted]',
  ],
  [/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g, '[email]'],
  // Long opaque tokens; canonical UUIDs are opaque IDs and stay readable.
  [/(?<![\w-])[A-Za-z0-9_-]{32,}/g, (m) => (UUID.test(m) ? m : '[redacted]')],
];

export function scrubString(value: string): string {
  const truncated = value.length > MAX_LENGTH;
  let out = truncated ? value.slice(0, MAX_LENGTH) : value;
  // Drizzle: "Failed query: <sql>\nparams: <values>". Values can be PII; keep a short SQL head only.
  const isQuery = /^\s*Failed query:/i.test(out);
  const params = out.search(/\bparams:/i);
  if (params >= 0) {
    const head = out.slice(0, params);
    out = `${isQuery ? head.slice(0, MAX_SQL_LENGTH) : head}params: [redacted]`;
  } else if (isQuery) {
    out = out.slice(0, MAX_SQL_LENGTH);
  }
  for (const [pattern, replacement] of REDACTIONS) {
    out = out.replace(pattern, replacement as string);
  }
  return truncated ? `${out}...` : out;
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
  selfHosted?: boolean,
): Sentry.NodeOptions | null {
  const dsn = getSentryDsn(env, selfHosted);
  if (!dsn) return null;
  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || 'production',
    release: env.SENTRY_RELEASE?.trim() || getServiceVersion(),
    sendDefaultPii: false,
    includeLocalVariables: false,
    // No tracesSampleRate / profiles / replay: tracing and profiling stay off.
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: scrubEvent,
    integrations: (defaults) => [
      ...defaults.filter((i) => !DROPPED_INTEGRATIONS.has(i.name)),
      // strict keeps Node's default: an unhandled rejection still terminates the process.
      Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
    ],
  };
}

export function initSentry(): boolean {
  const options = getSentryOptions();
  if (!options) return false;
  Sentry.init(options);
  return true;
}

/** Reports a failed job by ID tags only; never reads script, variables or logs from job.data. */
export function reportJobFailure(
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

/** Flushes queued events, waiting at most `timeoutMs`. */
export async function closeSentry(timeoutMs = 2000): Promise<void> {
  await Sentry.close(timeoutMs);
}
