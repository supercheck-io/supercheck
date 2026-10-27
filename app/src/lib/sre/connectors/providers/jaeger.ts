// Shared with the Private Agent worker; see provider-core.ts.
import {
  bearerHeaders,
  boundedJson,
  hasControlChars,
  isRecord,
  requestJson,
  requireEndpoint,
  rowLimit,
  stringOf,
  type ProviderContext,
  type ProviderRecord,
  type ProviderResult,
  type ProviderSearchParams,
  PROVIDER_MAX_RESPONSE_BYTES,
} from './provider-core';

const PROVIDER = 'Jaeger';
const DURATION_PATTERN = /^\d{1,6}(?:\.\d+)?(?:ns|us|µs|ms|s|m|h)$/;
const TRACE_ID_PATTERN = /^[0-9a-f]{1,32}$/i;
const isValidName = (value: string) =>
  value.length >= 1 && value.length <= 200 && !hasControlChars(value);
const TAG_KEYS = [
  'error',
  'otel.status_code',
  'http.status_code',
  'http.response.status_code',
  'http.method',
  'http.route',
  'db.system',
  'rpc.grpc.status_code',
  'exception.type',
  'exception.message',
];

export type JaegerQuery = {
  service?: string;
  operation?: string;
  traceId?: string;
  minDuration?: string;
  maxDuration?: string;
  tags: Record<string, string>;
  listServices: boolean;
};

export function parseJaegerQuery(query: string): JaegerQuery {
  const parsed: JaegerQuery = { tags: {}, listServices: false };
  const trimmed = query.trim();
  if (!trimmed || trimmed === '*') {
    parsed.listServices = true;
    return parsed;
  }

  const tokens =
    trimmed.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((token) => token) ?? [];
  for (const token of tokens) {
    const separator = token.search(/[:=]/);
    if (separator <= 0) {
      if (!parsed.service) parsed.service = unquote(token);
      continue;
    }
    const key = token.slice(0, separator).trim();
    const value = unquote(token.slice(separator + 1).trim());
    if (!value) continue;
    switch (key.toLowerCase()) {
      case 'service':
        parsed.service = value;
        break;
      case 'operation':
        parsed.operation = value;
        break;
      case 'trace':
      case 'traceid':
        parsed.traceId = value;
        break;
      case 'minduration':
        parsed.minDuration = value;
        break;
      case 'maxduration':
        parsed.maxDuration = value;
        break;
      case 'tag': {
        const eq = value.indexOf('=');
        if (eq > 0) parsed.tags[value.slice(0, eq)] = value.slice(eq + 1);
        break;
      }
      default:
        parsed.tags[key] = value;
    }
  }

  if (parsed.service && !isValidName(parsed.service))
    throw new Error('Jaeger service name is invalid');
  if (parsed.operation && !isValidName(parsed.operation))
    throw new Error('Jaeger operation name is invalid');
  if (parsed.traceId && !TRACE_ID_PATTERN.test(parsed.traceId))
    throw new Error('Jaeger trace ID must be 1-32 hexadecimal characters');
  for (const duration of [parsed.minDuration, parsed.maxDuration]) {
    if (duration && !DURATION_PATTERN.test(duration))
      throw new Error('Jaeger durations must look like 500ms, 1.5s or 2m');
  }
  if (Object.keys(parsed.tags).length > 10)
    throw new Error('Jaeger queries support at most 10 tags');
  if (!parsed.service && !parsed.traceId) {
    throw new Error(
      'Jaeger query needs service:<name> (optional operation:, error:true, minDuration:500ms, tag:key=value) or trace:<id>. Use * to list services',
    );
  }
  return parsed;
}

function unquote(value: string) {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

type JaegerSpan = {
  spanID?: string;
  operationName?: string;
  startTime?: number;
  duration?: number;
  processID?: string;
  tags?: Array<{ key?: string; value?: unknown }>;
};

function spanTags(span: JaegerSpan) {
  const selected: Record<string, string> = {};
  for (const tag of span.tags ?? []) {
    if (!tag.key || !TAG_KEYS.includes(tag.key)) continue;
    const value = stringOf(tag.value, 200);
    if (value) selected[tag.key] = value;
  }
  return selected;
}

function spanHasError(span: JaegerSpan) {
  return (span.tags ?? []).some(
    (tag) =>
      (tag.key === 'error' && (tag.value === true || tag.value === 'true')) ||
      (tag.key === 'otel.status_code' && tag.value === 'ERROR'),
  );
}

export function jaegerTraceRecord(
  endpoint: string,
  trace: unknown,
  fallback: Date,
): ProviderRecord | null {
  if (!isRecord(trace)) return null;
  const traceId = stringOf(trace.traceID, 64);
  const spans = (Array.isArray(trace.spans) ? trace.spans : []).filter(
    isRecord,
  ) as JaegerSpan[];
  if (!traceId || spans.length === 0) return null;
  const processes = isRecord(trace.processes) ? trace.processes : {};
  const serviceOf = (span: JaegerSpan) => {
    const process = span.processID ? processes[span.processID] : undefined;
    return (
      (isRecord(process) ? stringOf(process.serviceName, 120) : null) ??
      'unknown-service'
    );
  };

  const startMicros = Math.min(
    ...spans.map((span) => span.startTime ?? Infinity),
  );
  const endMicros = Math.max(
    ...spans.map((span) => (span.startTime ?? 0) + (span.duration ?? 0)),
  );
  const durationMs = Number.isFinite(startMicros)
    ? Math.max(0, (endMicros - startMicros) / 1000)
    : 0;
  const root = spans.find((span) => span.startTime === startMicros) ?? spans[0];
  const services = Array.from(new Set(spans.map(serviceOf))).slice(0, 20);
  const errorSpans = spans.filter(spanHasError);
  const slowest = [...spans]
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    .slice(0, 5);
  const describe = (span: JaegerSpan) => ({
    service: serviceOf(span),
    operation: stringOf(span.operationName, 160),
    durationMs: Math.round((span.duration ?? 0) / 100) / 10,
    tags: spanTags(span),
  });

  const rootService = serviceOf(root);
  const rootOperation = stringOf(root.operationName, 120) ?? 'trace';
  return {
    title: `Jaeger trace: ${rootService} ${rootOperation}`,
    summary: [
      traceId,
      `duration ${durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)}s` : `${Math.round(durationMs)}ms`}`,
      `${spans.length} span(s)`,
      `services ${services.slice(0, 10).join(', ')}`,
      errorSpans.length ? `${errorSpans.length} error span(s)` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    rawContent: boundedJson({
      traceID: traceId,
      durationMs: Math.round(durationMs),
      spanCount: spans.length,
      services,
      errorSpans: errorSpans.slice(0, 5).map(describe),
      slowestSpans: slowest.map(describe),
    }),
    evidenceType: 'trace',
    observedAt: Number.isFinite(startMicros)
      ? new Date(startMicros / 1000).toISOString()
      : fallback.toISOString(),
    severity: errorSpans.length ? 'error' : undefined,
    tags: [
      'jaeger',
      'trace',
      ...services.slice(0, 10).map((service) => `service:${service}`),
    ],
    sourceUri: `${endpoint}/trace/${encodeURIComponent(traceId)}`,
    hashInput: { traceId, spans: spans.length, startMicros, endMicros },
  };
}

export async function validateJaeger(ctx: ProviderContext) {
  const endpoint = requireEndpoint(ctx, PROVIDER);
  await requestJson(ctx, PROVIDER, {
    url: `${endpoint}/api/services`,
    method: 'GET',
    headers: bearerHeaders(ctx.credential),
    timeoutMs: 10_000,
    maxBytes: PROVIDER_MAX_RESPONSE_BYTES,
    target: 'endpoint',
  });
}

export async function searchJaeger(
  ctx: ProviderContext,
  params: ProviderSearchParams,
): Promise<ProviderResult> {
  const endpoint = requireEndpoint(ctx, PROVIDER);
  const query = parseJaegerQuery(params.query);
  const limit = rowLimit(params);
  const timeoutMs = params.maxSeconds * 1000;
  const get = (url: string) =>
    requestJson(ctx, PROVIDER, {
      url,
      method: 'GET',
      headers: bearerHeaders(ctx.credential),
      timeoutMs,
      maxBytes: PROVIDER_MAX_RESPONSE_BYTES,
      target: 'endpoint',
    });

  if (query.listServices) {
    const payload = await get(`${endpoint}/api/services`);
    const all = (
      isRecord(payload) && Array.isArray(payload.data) ? payload.data : []
    ).filter((entry): entry is string => typeof entry === 'string');
    const services = all.slice(0, limit * 5);
    return {
      records: [
        {
          title: 'Jaeger services',
          summary: `${all.length} service(s): ${services.slice(0, 30).join(', ')}`,
          rawContent: boundedJson({ services }),
          evidenceType: 'topology',
          observedAt: params.timeWindow.end.toISOString(),
          tags: ['jaeger', 'services'],
          sourceUri: `${endpoint}/api/services`,
          hashInput: services,
        },
      ],
      truncated: all.length > services.length,
    };
  }

  const startMs = params.timeWindow.start.getTime();
  const endMs = params.timeWindow.end.getTime();
  let traces: unknown[];
  if (query.traceId) {
    const payload = await get(
      `${endpoint}/api/traces/${encodeURIComponent(query.traceId.toLowerCase())}`,
    );
    traces =
      isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  } else {
    const url = new URL(`${endpoint}/api/traces`);
    url.searchParams.set('service', query.service as string);
    url.searchParams.set('start', String(startMs * 1000));
    url.searchParams.set('end', String(endMs * 1000));
    url.searchParams.set('limit', String(limit + 1));
    if (query.operation) url.searchParams.set('operation', query.operation);
    if (query.minDuration)
      url.searchParams.set('minDuration', query.minDuration);
    if (query.maxDuration)
      url.searchParams.set('maxDuration', query.maxDuration);
    if (Object.keys(query.tags).length)
      url.searchParams.set('tags', JSON.stringify(query.tags));
    const payload = await get(url.toString());
    traces =
      isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  }

  const records = traces
    .map((trace) => jaegerTraceRecord(endpoint, trace, params.timeWindow.end))
    // A trace fetched by ID is not time scoped by the API, so enforce the window here.
    .filter((record): record is ProviderRecord => {
      if (!record) return false;
      const observed = new Date(record.observedAt).getTime();
      return observed >= startMs && observed <= endMs;
    })
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return {
    records: records.slice(0, limit),
    truncated: records.length > limit,
  };
}
