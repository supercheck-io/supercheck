/**
 * Sentry scrubbing rules, shared by the server SDK (./sentry.ts) and the browser
 * SDK (components/sentry-browser.tsx). Type-only SDK imports: this module never
 * loads @sentry/* code itself.
 *
 * Keep in sync with worker/src/common/sentry-scrub.ts (a copy).
 */
import type {
  ErrorEvent,
  Log,
  Metric,
  SpanJSON,
  TransactionEvent,
} from "@sentry/core";

const MAX_LENGTH = 500;
const MAX_SQL_LENGTH = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ALLOWED_TAGS = new Set([
  "organizationId",
  "projectId",
  "service",
  "runId",
  "jobId",
  "queue",
]);
const ALLOWED_CONTEXTS = new Set([
  "runtime",
  "os",
  "trace",
  "browser",
  "device",
  "culture",
]);

// Every pattern is linear: input is truncated first and no quantifiers nest or
// overlap (key prefixes/suffixes and URL schemes are length-bounded).
const REDACTIONS: Array<[RegExp, string | ((m: string) => string)]> = [
  // Quoted literals (selectors, expected text, JSON keys/values, code); an unterminated one runs to the end.
  [/"[^"]*(?:"|$)|`[^`]*(?:`|$)|(?<!\w)'[^']*(?:'|$)/g, "[text]"],
  // Whole header value: covers Basic/Bearer/custom schemes and cookie lists.
  [
    /\b(authorization|proxy-authorization|set-cookie|cookie)[ \t]*[:=][^\r\n]*/gi,
    "$1: [redacted]",
  ],
  [/\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s<>]+/gi, "[url]"], // URLs and connection strings
  [/\bBearer[ \t]+[\w.~+/=-]+/gi, "Bearer [redacted]"],
  [/\bBasic[ \t]+[A-Za-z0-9+/=]{8,}/g, "Basic [redacted]"],
  [
    /\b([\w-]{0,40}(?:key|token|secret|passw(?:or)?d|pwd|auth|cookie|session)[\w-]{0,40})["']?[ \t]*[=:][ \t]*[^\s,;&]+/gi,
    "$1=[redacted]",
  ],
  [/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g, "[email]"],
  // IP literals (network errors: ECONNREFUSED 203.0.113.5:443, [2001:db8::1]:8443).
  [/\[[0-9a-f:.]{2,45}\](?::\d{1,5})?/gi, "[ip]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, "[ip]"],
  [
    /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b|\b[0-9a-f]{1,4}::[0-9a-f:]{0,38}/gi,
    "[ip]",
  ],
  // Bare lowercase hostnames (ENOTFOUND api.acme.com, "Ping to acme.com failed"); file names and
  // property paths are kept (see isCodeName).
  [
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,10}[a-z]{2,24}\b(?![(\w])/g,
    (m) => (isCodeName(m) ? m : "[host]"),
  ],
  // Long opaque tokens; canonical UUIDs are opaque IDs and stay readable.
  [/(?<![\w-])[A-Za-z0-9_-]{32,}/g, (m) => (UUID.test(m) ? m : "[redacted]")],
];

// Last labels that mark a file name or code path rather than a hostname.
const CODE_SUFFIXES = new Set([
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "json",
  "map",
  "md",
  "sql",
  "yml",
  "yaml",
  "txt",
  "html",
  "css",
  "env",
  "log",
  "lock",
  "sh",
  "py",
  "go",
  "node",
  "then",
  "catch",
  "length",
  "prototype",
  "call",
  "apply",
  "bind",
  "push",
  "keys",
  "values",
  "entries",
  "toString",
  "parse",
  "stringify",
  "service",
  "controller",
  "processor",
  "module",
  "spec",
  "test",
  "type",
  "id",
  "name",
  "data",
]);
// SDK span ops and origins ("http.client", "auto.log.pino", "db.redis") are dotted too.
const CODE_PREFIXES = new Set([
  "http",
  "db",
  "ui",
  "queue",
  "cache",
  "function",
  "resource",
  "navigation",
  "pageload",
  "sentry",
  "otel",
  "auto",
  "manual",
  "gen_ai",
  "react",
  "pino",
  "middleware",
  "rpc",
  "grpc",
  "mark",
  "measure",
  "paint",
  "process",
  "console",
  "this",
  "window",
  "document",
  "module",
  "exports",
  "globalThis",
  "job",
  "err",
  "error",
  "req",
  "res",
  "data",
  "result",
  "response",
  "monitor",
  "test",
  "run",
  "event",
  "span",
  "options",
  "config",
]);

function isCodeName(name: string): boolean {
  const labels = name.split(".");
  return (
    CODE_SUFFIXES.has(labels[labels.length - 1]) || CODE_PREFIXES.has(labels[0])
  );
}

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

// ---------------------------------------------------------------------------
// URLs, span names, SQL
// ---------------------------------------------------------------------------

// Path segments whose next segment is a secret or customer value.
const SECRET_PARENTS = new Set([
  "invite",
  "unsubscribe",
  "verify",
  "custom-domain",
  "reset-password",
  "token",
  "tokens",
]);
// Hosts we own or pay for; any other host is a customer target and becomes [target].
const VENDOR_HOSTS = [
  /(^|\.)polar\.sh$/,
  /(^|\.)sentry\.io$/,
  /(^|\.)openai\.com$/,
  /(^|\.)anthropic\.com$/,
  /(^|\.)googleapis\.com$/,
  /(^|\.)openrouter\.ai$/,
  /(^|\.)resend\.com$/,
];

let ownHosts: Set<string> | null = null;
function getOwnHosts(): Set<string> {
  if (ownHosts) return ownHosts;
  const hosts = new Set<string>();
  const env: Record<string, string | undefined> =
    typeof process !== "undefined" ? process.env : {};
  for (const raw of [
    env.NEXT_PUBLIC_APP_URL,
    env.APP_URL,
    env.BETTER_AUTH_URL,
    env.S3_ENDPOINT,
  ]) {
    try {
      if (raw) hosts.add(new URL(raw).hostname.toLowerCase());
    } catch {
      // ignore malformed config
    }
  }
  const loc = (globalThis as { location?: { hostname?: string } }).location;
  if (loc?.hostname) hosts.add(loc.hostname.toLowerCase());
  return (ownHosts = hosts);
}

/** Exported for tests: resets the cached first-party host list. */
export function resetOwnHostsForTest(): void {
  ownHosts = null;
}

function isFirstPartyHost(host: string): boolean {
  // IPv6 literals and anything with several colons are never first-party.
  if (host.includes("[") || (host.match(/:/g)?.length ?? 0) > 1) return false;
  const h = host.toLowerCase().replace(/:\d+$/, "");
  // Dotless names are in-cluster services (or localhost); customer egress always uses a public FQDN.
  if (!h.includes(".") || h === "127.0.0.1") return true;
  return getOwnHosts().has(h) || VENDOR_HOSTS.some((re) => re.test(h));
}

function scrubPath(path: string): string {
  const segments = path.split("/");
  return segments
    .map((seg, i) => {
      if (!seg || seg.startsWith("[")) return seg; // empty or a route template like [id]
      if (SECRET_PARENTS.has(segments[i - 1]?.toLowerCase() ?? ""))
        return "[token]";
      if (UUID.test(seg) || /^\d+$/.test(seg)) return seg;
      if (seg.includes("@")) return "[email]";
      if (
        seg.length > 24 ||
        /[A-Za-z0-9_-]{20,}/.test(seg) ||
        seg.includes(":")
      )
        return "[token]";
      return seg;
    })
    .join("/");
}

/** Keeps scheme, first-party host and path shape; drops query, fragment, credentials and customer hosts. */
export function scrubUrl(raw: string): string {
  const value = raw.slice(0, 2000);
  const abs = /^([a-z][a-z0-9+.-]{0,30}):\/\/([^/?#\s]*)([^?#\s]*)/i.exec(
    value,
  );
  if (abs) {
    const authority = abs[2].replace(/^[^@]*@/, ""); // drop user:pass@
    // A customer URL keeps neither host nor path (paths can carry customer names and ids).
    if (!isFirstPartyHost(authority)) return `${abs[1]}://[target]`;
    return `${abs[1]}://${authority}${scrubPath(abs[3])}`;
  }
  const rel = /^([^?#\s]*)/.exec(value);
  return scrubPath(rel ? rel[1] : "");
}

const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s<>"']+/gi;
const METHOD_PATH = /^([A-Z]{3,7}) (\/\S*)(.*)$/;

/** Span and transaction names: "GET /invite/abc", "GET https://customer/x", "render route /status/[id]". */
export function scrubName(name: string): string {
  let out = name.slice(0, MAX_LENGTH).replace(URL_IN_TEXT, (m) => scrubUrl(m));
  const mp = METHOD_PATH.exec(out);
  if (mp) out = `${mp[1]} ${scrubUrl(mp[2])}${mp[3]}`;
  else if (out.startsWith("/")) out = scrubUrl(out);
  return out;
}

/** SQL text with placeholders only: literals are replaced and the text is capped. */
export function scrubSql(sql: string): string {
  return sql
    .slice(0, MAX_SQL_LENGTH * 2)
    .replace(/'(?:[^']|'')*'?/g, "?")
    .replace(/(?<![\w$])-?\d+(?:\.\d+)?\b/g, "?")
    .slice(0, MAX_SQL_LENGTH);
}

// ---------------------------------------------------------------------------
// Spans and transactions
// ---------------------------------------------------------------------------

const SPAN_KEEP_EXACT = new Set([
  "http.request.method",
  "http.method",
  "http.response.status_code",
  "http.status_code",
  "url.scheme",
  "db.system",
  "db.system.name",
  "db.operation",
  "db.operation.name",
  "db.name",
  "db.namespace",
  "network.protocol.version",
  "http.flavor",
  "gen_ai.system",
  "gen_ai.operation.name",
  "gen_ai.request.model",
  "gen_ai.response.model",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
  ...ALLOWED_TAGS,
]);
const SPAN_URL_KEYS = new Set([
  "url.full",
  "url.path",
  "http.url",
  "http.target",
  "http.route",
  "next.route",
  "url",
]);
const SPAN_SQL_KEYS = new Set(["db.statement", "db.query.text"]);
const SPAN_KEEP_PREFIX = [
  "sentry.",
  "otel.",
  "next.",
  "cache.",
  "replay",
  "lcp.",
  "cls.",
  "browser.",
  "resource.render_blocking_status",
];

function redisHead(statement: string): string {
  return scrubString(
    statement.split(/\s+/).slice(0, 2).join(" ").slice(0, 120),
  );
}

function isRedisSpan(data: Record<string, unknown> | undefined): boolean {
  return (
    data?.["db.system"] === "redis" || data?.["db.system.name"] === "redis"
  );
}

/** Allow-lists span attributes; URLs and names are scrubbed, SQL keeps placeholders only. */
export function scrubSpanData(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!data) return out;
  const isRedis = isRedisSpan(data);
  for (const [key, value] of Object.entries(data)) {
    if (SPAN_SQL_KEYS.has(key)) {
      if (typeof value !== "string") continue;
      // Redis statements can carry values (job payloads, EVAL args); keep the command and key only.
      out[key] = isRedis ? redisHead(value) : scrubSql(value);
      continue;
    }
    const keep =
      SPAN_URL_KEYS.has(key) ||
      SPAN_KEEP_EXACT.has(key) ||
      SPAN_KEEP_PREFIX.some((p) => key.startsWith(p));
    if (!keep) continue;
    if (typeof value === "string")
      out[key] = SPAN_URL_KEYS.has(key)
        ? scrubUrl(value)
        : scrubString(scrubName(value));
    else if (typeof value === "number" || typeof value === "boolean")
      out[key] = value;
  }
  return out;
}

export function scrubSpan<
  T extends Pick<SpanJSON, "description" | "data" | "op">,
>(span: T): T {
  if (span.description) {
    // Sentry gives redis spans op "db" and the full statement as description, so check db.system.
    if (isRedisSpan(span.data)) span.description = redisHead(span.description);
    else if (span.op?.startsWith("db"))
      span.description = scrubSql(span.description);
    // http spans: scrubName already reduces customer URLs to scheme://[target].
    else if (span.op?.startsWith("http"))
      span.description = scrubName(span.description);
    else span.description = scrubString(scrubName(span.description));
  }
  span.data = scrubSpanData(span.data) as T["data"];
  return span;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function scrubCommon<T extends ErrorEvent | TransactionEvent>(event: T): T {
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
    const trace = event.contexts.trace;
    if (trace) trace.data = scrubSpanData(trace.data);
  }

  if (event.tags) {
    for (const key of Object.keys(event.tags)) {
      if (!ALLOWED_TAGS.has(key)) delete event.tags[key];
    }
  }
  if (event.transaction) event.transaction = scrubName(event.transaction);
  return event;
}

/** beforeSend: keeps error type/message (scrubbed), stack, release, allow-listed IDs. */
export function scrubEvent<T extends ErrorEvent>(event: T): T {
  scrubCommon(event);
  if (event.message) event.message = scrubString(event.message);
  if (event.logentry)
    event.logentry = { message: scrubString(event.logentry.message ?? "") };

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

/** beforeSendTransaction: scrubs the root name, trace context and every child span. */
export function scrubTransaction<T extends TransactionEvent>(event: T): T {
  scrubCommon(event);
  for (const span of event.spans ?? []) scrubSpan(span);
  return event;
}

// ---------------------------------------------------------------------------
// Logs and metrics
// ---------------------------------------------------------------------------

const LOG_ATTRS = new Set([
  ...ALLOWED_TAGS,
  "orgId",
  "testId",
  "monitorId",
  "module",
  "context",
  "operationName",
  "duration",
  "success",
  "status",
  "type",
  "location",
  "pino.logger.level",
]);

function scrubAttributes(
  attrs: Record<string, unknown> | undefined,
  allowed: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs ?? {})) {
    const sdkKey =
      key.startsWith("sentry.") &&
      !key.startsWith("sentry.message.parameter") &&
      key !== "sentry.message.template";
    if (!sdkKey && !allowed.has(key)) continue;
    if (typeof value === "string") out[key] = scrubString(value);
    else if (typeof value === "number" || typeof value === "boolean")
      out[key] = value;
  }
  return out;
}

/** beforeSendLog: drops trace/debug, scrubs the message, keeps allow-listed attributes only. */
export function scrubLog(log: Log): Log | null {
  if (log.level === "trace" || log.level === "debug") return null;
  log.message = scrubString(String(log.message ?? ""));
  log.attributes = scrubAttributes(log.attributes, LOG_ATTRS);
  return log;
}

const METRIC_ATTRS = new Set([
  ...ALLOWED_TAGS,
  "type",
  "cause",
  "location",
  "tool",
  "status",
]);

/** beforeSendMetric: allow-listed attributes only. */
export function scrubMetric(metric: Metric): Metric | null {
  metric.attributes = scrubAttributes(metric.attributes, METRIC_ATTRS);
  return metric;
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

// Health probes, metrics, long-lived SSE streams, static assets, public status pages,
// auth callbacks and our own config endpoint never produce traces.
const UNSAMPLED = [
  /^\/(api\/)?health(\/|$)/,
  /^\/queue-alerting\//,
  /^\/$/, // worker root health
  /^\/_next\//,
  /^\/favicon/,
  /^\/status(\/|$)/,
  /^\/api\/auth\//,
  /^\/api\/client-config\//,
  /^\/api\/(test-status|job-status|executions)\/events/,
  /^\/api\/queue-stats\/sse/,
  /^\/api\/runs\/[^/]+\/stream/,
  /^\/api\/ai\//,
  /^\/api\/sre\/evidence-brief\/stream/,
];

/** Rate in [0,1] from env; anything else means off. */
export function parseRate(raw: string | undefined, fallback = 0): number {
  const n = Number(raw);
  return raw?.trim() && Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

/** True when a request path or span name ("GET /api/health") must never be traced. */
export function isUnsampledPath(nameOrPath: string | undefined): boolean {
  if (!nameOrPath) return false;
  const path = nameOrPath
    .replace(/^[A-Z]{3,7} /, "")
    .replace(/^[a-z]+:\/\/[^/]+/i, "")
    .split("?")[0];
  return UNSAMPLED.some((re) => re.test(path));
}
