import * as crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const PROTOCOL_VERSION = '2026-06-22';
const DEFAULT_RETRY_INTERVAL_MS = 5_000;
const DEFAULT_LEASE_WAIT_MS = 25_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_RESULT_ITEMS = 100;

const credentialValueSchema = z
  .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .nullable()
  .optional();

const connectorJobSpecSchema = z.object({
  jobClass: z.literal('sre_connector_query'),
  connectorId: z.string().min(1),
  connectorType: z.enum([
    'github',
    'prometheus',
    'grafana',
    'kubernetes',
    'sentry',
    'datadog',
    'loki',
    'elasticsearch',
    'tempo',
    'aws_cloudwatch',
  ]),
  endpointUrl: z.string().url().nullable(),
  serviceId: z.string().min(1),
  query: z.string().min(1).max(500),
  timeWindow: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }),
  budget: z.object({
    maxRows: z.number().int().min(1).max(1000),
    maxBytes: z
      .number()
      .int()
      .min(1024)
      .max(5 * 1024 * 1024),
    maxSeconds: z.number().int().min(1).max(30),
    maxCost: z.number().min(0),
  }),
  filters: z.record(z.unknown()).default({}),
});

const leasedJobSchema = z.object({
  id: z.string().uuid(),
  jobClass: z.literal('sre_connector_query'),
  connectorId: z.string().uuid().nullable(),
  projectId: z.string().uuid(),
  jobSpec: connectorJobSpecSchema,
  jobSpecHash: z.string().regex(/^[a-f0-9]{64,128}$/i),
  leaseExpiresAt: z.string().datetime(),
  credential: z
    .object({
      credentialType: z.string().max(30),
      value: credentialValueSchema,
    })
    .nullable(),
});

const leaseResponseSchema = z.object({
  job: leasedJobSchema.nullable(),
  leaseToken: z.string().optional(),
});

const registrationExchangeResponseSchema = z.object({
  token: z.string().min(20),
  keyId: z.string().min(1),
  agent: z.object({
    id: z.string().uuid(),
    status: z.string(),
    registeredAt: z.string().datetime(),
  }),
});

type ConnectorJobSpec = z.infer<typeof connectorJobSpecSchema>;
type LeasedJob = z.infer<typeof leasedJobSchema>;

export type PrivateAgentConfig = {
  apiUrl: string;
  agentId: string;
  token: string;
  tokenSource: 'env' | 'file';
  credentialFile: string | null;
  agentVersion: string;
  retryIntervalMs: number;
  leaseWaitMs: number;
  heartbeatIntervalMs: number;
};

type EvidenceSummary = {
  id: string;
  sourceUri: string;
  title: string;
  summary: string;
  evidenceType: string;
  observedAt: string;
  resultHash: string;
};

type ConnectorExecutionResult = {
  evidence: EvidenceSummary[];
  truncated: boolean;
  resultHash: string;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function hashPayload(payload: unknown): string {
  return crypto
    .createHash('sha256')
    .update(stableStringify(payload))
    .digest('hex');
}

function evidenceId(connectorId: string, sourceUri: string, title: string) {
  return `connector_${hashPayload({ connectorId, sourceUri, title }).slice(0, 24)}`;
}

function credentialString(job: LeasedJob, keys: string[]) {
  const value = job.credential?.value;
  if (!value) return null;

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === 'number' || typeof candidate === 'boolean') {
      return String(candidate);
    }
  }

  return null;
}

function secretFromCredential(job: LeasedJob) {
  return credentialString(job, ['secret']);
}

function apiKeyFromCredential(job: LeasedJob) {
  return credentialString(job, [
    'apiKey',
    'api_key',
    'accessKeyId',
    'access_key_id',
    'secret',
  ]);
}

function applicationKeyFromCredential(job: LeasedJob) {
  return credentialString(job, [
    'applicationKey',
    'application_key',
    'appKey',
    'app_key',
  ]);
}

function sessionTokenFromCredential(job: LeasedJob) {
  return credentialString(job, [
    'sessionToken',
    'session_token',
    'awsSessionToken',
    'aws_session_token',
    'applicationKey',
    'application_key',
  ]);
}

function regionFromCredential(job: LeasedJob) {
  return credentialString(job, ['region', 'awsRegion', 'aws_region']);
}

function normalizedEndpoint(spec: ConnectorJobSpec) {
  if (spec.connectorType === 'github') {
    return (spec.endpointUrl ?? 'https://api.github.com').replace(/\/$/, '');
  }

  if (spec.connectorType === 'datadog') {
    return (spec.endpointUrl ?? 'https://api.datadoghq.com').replace(/\/$/, '');
  }

  if (spec.connectorType === 'aws_cloudwatch') {
    return (
      spec.endpointUrl ?? 'https://monitoring.us-east-1.amazonaws.com'
    ).replace(/\/$/, '');
  }

  if (!spec.endpointUrl) {
    throw new Error(`${spec.connectorType} connector requires endpointUrl`);
  }

  return spec.endpointUrl.replace(/\/$/, '');
}

function assertAgentEndpointAllowed(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Connector endpoint must use http or https');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  ) {
    throw new Error(
      'Private Agent connector endpoints cannot target localhost',
    );
  }

  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error(
      'Private Agent connector endpoints cannot target cloud metadata endpoints',
    );
  }
}

function dateFromUnixNs(value: string | number | undefined, fallback: string) {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;

  return new Date(Math.floor(numeric / 1_000_000)).toISOString();
}

function severityFromLogLine(value: string) {
  const lowered = value.toLowerCase();
  if (
    lowered.includes('fatal') ||
    lowered.includes('panic') ||
    lowered.includes('critical')
  ) {
    return 'critical';
  }
  if (lowered.includes('error') || lowered.includes('exception')) {
    return 'error';
  }
  if (lowered.includes('warn')) return 'warning';
  if (lowered.includes('info')) return 'info';
  return null;
}

function sourceString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    const nested = key.split('.').reduce<unknown>((current, part) => {
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        return (current as Record<string, unknown>)[part];
      }

      return undefined;
    }, source);
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
    if (typeof nested === 'number' || typeof nested === 'boolean') {
      return String(nested);
    }
  }

  return null;
}

function stringValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function tempoAttributeValue(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const attributeValue = value as Record<string, unknown>;
  return (
    stringValue(attributeValue.stringValue) ??
    stringValue(attributeValue.intValue) ??
    stringValue(attributeValue.doubleValue) ??
    stringValue(attributeValue.boolValue) ??
    stringValue(attributeValue.arrayValue)
  );
}

function tempoTraceHasError(trace: unknown) {
  const serialized = JSON.stringify(trace).toLowerCase();
  return serialized.includes('"status"') && serialized.includes('error');
}

function durationSummary(durationMs: unknown) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
    return null;
  }
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(2)}s`;
  return `${Math.round(durationMs)}ms`;
}

function isTraceQlQuery(query: string) {
  const trimmed = query.trim();
  return (
    trimmed.startsWith('{') ||
    trimmed.includes('&&') ||
    trimmed.includes('||') ||
    trimmed.includes('|')
  );
}

function normalizeTempoSearchQuery(query: string) {
  const trimmed = query.trim();
  if (!trimmed || trimmed === '*') {
    return { tags: '' };
  }

  if (isTraceQlQuery(trimmed)) {
    return { q: trimmed };
  }

  const tags: string[] = [];
  let minDuration: string | undefined;
  let maxDuration: string | undefined;

  for (const token of trimmed.split(/\s+/).filter(Boolean)) {
    const separator = token.indexOf(':');
    if (separator === -1) {
      tags.push(token.includes('=') ? token : `service.name=${token}`);
      continue;
    }

    const key = token.slice(0, separator).trim();
    const value = token.slice(separator + 1).trim();
    if (!key || !value) continue;

    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'minduration') {
      minDuration = value;
    } else if (normalizedKey === 'maxduration') {
      maxDuration = value;
    } else if (normalizedKey === 'service') {
      tags.push(`service.name=${value}`);
    } else if (normalizedKey === 'operation') {
      tags.push(`name=${value}`);
    } else {
      tags.push(`${key}=${value}`);
    }
  }

  return {
    tags: tags.join(' '),
    minDuration,
    maxDuration,
  };
}

function awsAmzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function awsDateStamp(amzDate: string) {
  return amzDate.slice(0, 8);
}

function hmac(key: crypto.BinaryLike | crypto.KeyObject, value: string) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function sha256Hex(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function cloudWatchRegion(endpointUrl: string, configuredRegion?: string | null) {
  if (configuredRegion?.trim()) return configuredRegion.trim();

  const host = new URL(endpointUrl).hostname;
  const match = host.match(/^monitoring(?:-fips)?[.-]([a-z0-9-]+)\./);
  return match?.[1] ?? 'us-east-1';
}

function xmlDecode(value: string | undefined) {
  if (!value) return '';
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function xmlText(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return xmlDecode(match?.[1]);
}

function xmlBlocks(xml: string, tag: string) {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const blocks: string[] = [];
  let cursor = 0;

  while (cursor < xml.length) {
    const start = xml.indexOf(openTag, cursor);
    if (start === -1) break;

    let depth = 1;
    let searchFrom = start + openTag.length;

    while (depth > 0) {
      const nextOpen = xml.indexOf(openTag, searchFrom);
      const nextClose = xml.indexOf(closeTag, searchFrom);
      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        searchFrom = nextOpen + openTag.length;
        continue;
      }

      depth -= 1;
      if (depth === 0) {
        blocks.push(xml.slice(start + openTag.length, nextClose));
        cursor = nextClose + closeTag.length;
        break;
      }

      searchFrom = nextClose + closeTag.length;
    }

    if (depth > 0) break;
  }

  return blocks;
}

function xmlMemberValues(xml: string, containerTag: string) {
  const container = xmlText(xml, containerTag)
    ? xmlBlocks(xml, containerTag)[0]
    : '';
  return container
    ? xmlBlocks(container, 'member').map((block) => xmlDecode(block))
    : [];
}

function cloudWatchSeverity(state: string) {
  if (state === 'ALARM') return 'critical';
  if (state === 'INSUFFICIENT_DATA') return 'warning';
  if (state === 'OK') return 'info';
  return null;
}

type CloudWatchQueryShape = {
  namespace?: string;
  metricName?: string;
  statistic: string;
  periodSeconds: number;
  dimensions: Array<{ name: string; value: string }>;
  alarmPrefix?: string;
  stateValue?: string;
  freeText: string;
};

function parseCloudWatchQuery(query: string): CloudWatchQueryShape {
  const parsed: CloudWatchQueryShape = {
    statistic: 'Average',
    periodSeconds: 60,
    dimensions: [],
    freeText: '',
  };
  const freeText: string[] = [];

  for (const token of query.trim().split(/\s+/).filter(Boolean)) {
    const separator = token.indexOf(':');
    if (separator === -1) {
      freeText.push(token);
      continue;
    }

    const key = token.slice(0, separator).toLowerCase();
    const value = token.slice(separator + 1).trim();
    if (!value) continue;

    if (key === 'namespace' || key === 'ns') parsed.namespace = value;
    else if (key === 'metric' || key === 'metricname') {
      parsed.metricName = value;
    } else if (key === 'stat' || key === 'statistic') {
      parsed.statistic = value;
    } else if (key === 'period' || key === 'periodseconds') {
      parsed.periodSeconds = Math.min(Math.max(Number(value) || 60, 60), 3600);
    } else if (key === 'state') parsed.stateValue = value.toUpperCase();
    else if (key === 'prefix' || key === 'alarmprefix') {
      parsed.alarmPrefix = value;
    } else if (key === 'dimension' || key === 'dim') {
      const equalsAt = value.indexOf('=');
      if (equalsAt > 0) {
        parsed.dimensions.push({
          name: value.slice(0, equalsAt),
          value: value.slice(equalsAt + 1),
        });
      }
    } else {
      freeText.push(token);
    }
  }

  parsed.freeText = freeText.join(' ').trim();
  return parsed;
}

function privateAgentCapabilities() {
  return {
    supportsSreConnectors: true,
    supportsHttpMonitoring: false,
    supportsPlaywright: false,
    supportsK6: false,
    supportsNetworkChecks: false,
  };
}

async function fetchJson(
  url: string,
  secret: string | null,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<unknown> {
  assertAgentEndpointAllowed(url);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`credentials rejected with HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`connector request failed with HTTP ${response.status}`);
  }

  return response.json();
}

async function cloudWatchRequest(
  job: LeasedJob,
  parameters: Record<string, string>,
): Promise<string> {
  const spec = job.jobSpec;
  const endpoint = normalizedEndpoint(spec);
  assertAgentEndpointAllowed(endpoint);

  const endpointUrl = new URL(endpoint);
  const accessKeyId = apiKeyFromCredential(job);
  const secretAccessKey = secretFromCredential(job);
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'AWS CloudWatch connector requires apiKey/accessKeyId and secret/secretAccessKey credentials',
    );
  }

  const sessionToken = sessionTokenFromCredential(job);
  const region = cloudWatchRegion(endpoint, regionFromCredential(job));
  const amzDate = awsAmzDate();
  const dateStamp = awsDateStamp(amzDate);
  const body = new URLSearchParams({
    Version: '2010-08-01',
    ...parameters,
  }).toString();
  const payloadHash = sha256Hex(body);
  const canonicalHeaders =
    [
      'content-type:application/x-www-form-urlencoded; charset=utf-8',
      `host:${endpointUrl.host}`,
      `x-amz-date:${amzDate}`,
      ...(sessionToken ? [`x-amz-security-token:${sessionToken}`] : []),
    ].join('\n') + '\n';
  const signedHeaders = [
    'content-type',
    'host',
    'x-amz-date',
    ...(sessionToken ? ['x-amz-security-token'] : []),
  ].join(';');
  const canonicalRequest = [
    'POST',
    endpointUrl.pathname || '/',
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${dateStamp}/${region}/monitoring/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), 'monitoring'),
    'aws4_request',
  );
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign)
    .digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/xml',
      Authorization: authorization,
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      'X-Amz-Date': amzDate,
      ...(sessionToken ? { 'X-Amz-Security-Token': sessionToken } : {}),
    },
    body,
    signal: AbortSignal.timeout(spec.budget.maxSeconds * 1000),
    redirect: 'error',
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`credentials rejected with HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`connector request failed with HTTP ${response.status}`);
  }

  return response.text();
}

function bounded(
  items: EvidenceSummary[],
  maxRows: number,
): ConnectorExecutionResult {
  const limit = Math.min(maxRows, MAX_RESULT_ITEMS);
  const evidence = items.slice(0, limit);
  const truncated = items.length > evidence.length;
  return {
    evidence,
    truncated,
    resultHash: hashPayload({ evidence, truncated }),
  };
}

async function executeGitHub(
  job: LeasedJob,
): Promise<ConnectorExecutionResult> {
  const spec = job.jobSpec;
  const endpoint = normalizedEndpoint(spec);
  const url = `${endpoint}/search/commits?q=${encodeURIComponent(spec.query)}&per_page=${Math.min(spec.budget.maxRows, 20)}`;
  const payload = await fetchJson(
    url,
    secretFromCredential(job),
    spec.budget.maxSeconds * 1000,
    {
      Accept: 'application/vnd.github.cloak-preview+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  );
  const items = Array.isArray((payload as { items?: unknown[] }).items)
    ? (payload as { items: unknown[] }).items
    : [];

  return bounded(
    items.map((item) => {
      const commit = item as {
        html_url?: string;
        sha?: string;
        commit?: {
          message?: string;
          author?: { date?: string; name?: string };
        };
        repository?: { full_name?: string };
      };
      const title =
        commit.commit?.message?.split('\n')[0]?.slice(0, 180) ||
        commit.sha ||
        'GitHub commit';
      const sourceUri =
        commit.html_url ??
        `${endpoint}/search?q=${encodeURIComponent(spec.query)}`;
      return {
        id: evidenceId(spec.connectorId, sourceUri, title),
        sourceUri,
        title,
        summary: [
          commit.repository?.full_name,
          commit.commit?.author?.name,
          commit.sha?.slice(0, 12),
        ]
          .filter(Boolean)
          .join(' - '),
        evidenceType: 'deployment',
        observedAt: commit.commit?.author?.date ?? spec.timeWindow.end,
        resultHash: hashPayload(commit),
      };
    }),
    spec.budget.maxRows,
  );
}

async function executePrometheus(
  job: LeasedJob,
): Promise<ConnectorExecutionResult> {
  const spec = job.jobSpec;
  const endpoint = normalizedEndpoint(spec);
  const url = new URL(`${endpoint}/api/v1/query_range`);
  url.searchParams.set('query', spec.query);
  url.searchParams.set(
    'start',
    String(Math.floor(new Date(spec.timeWindow.start).getTime() / 1000)),
  );
  url.searchParams.set(
    'end',
    String(Math.floor(new Date(spec.timeWindow.end).getTime() / 1000)),
  );
  url.searchParams.set(
    'step',
    String(
      typeof spec.filters.stepSeconds === 'number'
        ? spec.filters.stepSeconds
        : 60,
    ),
  );
  const payload = await fetchJson(
    url.toString(),
    secretFromCredential(job),
    spec.budget.maxSeconds * 1000,
  );
  const result =
    (payload as { data?: { result?: unknown[] } }).data?.result ?? [];

  return bounded(
    result.map((series, index) => {
      const metricSeries = series as {
        metric?: Record<string, string>;
        values?: Array<[number, string]>;
      };
      const metricName = metricSeries.metric?.__name__ ?? spec.query;
      const sourceUri = `${endpoint}/graph?g0.expr=${encodeURIComponent(spec.query)}`;
      return {
        id: evidenceId(spec.connectorId, sourceUri, `${metricName}-${index}`),
        sourceUri,
        title: `Prometheus metric: ${metricName}`,
        summary: `${metricSeries.values?.length ?? 0} samples returned for ${spec.query}`,
        evidenceType: 'metric',
        observedAt: spec.timeWindow.end,
        resultHash: hashPayload(metricSeries),
      };
    }),
    spec.budget.maxRows,
  );
}

async function executeGrafana(
  job: LeasedJob,
): Promise<ConnectorExecutionResult> {
  const spec = job.jobSpec;
  const endpoint = normalizedEndpoint(spec);
  const url = new URL(`${endpoint}/api/search`);
  url.searchParams.set('query', spec.query);
  url.searchParams.set('limit', String(Math.min(spec.budget.maxRows, 50)));
  const payload = await fetchJson(
    url.toString(),
    secretFromCredential(job),
    spec.budget.maxSeconds * 1000,
  );
  const dashboards = Array.isArray(payload) ? payload : [];

  return bounded(
    dashboards.map((dashboard) => {
      const item = dashboard as {
        title?: string;
        url?: string;
        uri?: string;
        type?: string;
      };
      const sourceUri = item.url ? `${endpoint}${item.url}` : endpoint;
      const title = item.title ?? item.uri ?? 'Grafana dashboard';
      return {
        id: evidenceId(spec.connectorId, sourceUri, title),
        sourceUri,
        title,
        summary: `Grafana ${item.type ?? 'dashboard'} matched query ${spec.query}`,
        evidenceType: 'document',
        observedAt: spec.timeWindow.end,
        resultHash: hashPayload(item),
      };
    }),
    spec.budget.maxRows,
  );
}

async function executeKubernetes(
  job: LeasedJob,
): Promise<ConnectorExecutionResult> {
  const spec = job.jobSpec;
  const endpoint = normalizedEndpoint(spec);
  const namespace =
    typeof spec.filters.namespace === 'string' ? spec.filters.namespace : null;
  const basePath = namespace
    ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`
    : '/api/v1/pods';
  const url = new URL(`${endpoint}${basePath}`);
  url.searchParams.set('limit', String(Math.min(spec.budget.maxRows, 50)));
  if (spec.query.trim() && spec.query.trim() !== '*') {
    url.searchParams.set('labelSelector', spec.query.trim());
  }

  const payload = await fetchJson(
    url.toString(),
    secretFromCredential(job),
    spec.budget.maxSeconds * 1000,
  );
  const pods = Array.isArray((payload as { items?: unknown[] }).items)
    ? (payload as { items: unknown[] }).items
    : [];

  return bounded(
    pods.map((pod) => {
      const item = pod as {
        metadata?: { name?: string; namespace?: string };
        status?: {
          phase?: string;
          startTime?: string;
          containerStatuses?: Array<{
            name?: string;
            ready?: boolean;
            restartCount?: number;
          }>;
        };
      };
      const podNamespace = item.metadata?.namespace ?? namespace ?? 'default';
      const podName = item.metadata?.name ?? 'unknown-pod';
      const sourceUri = `${endpoint}/api/v1/namespaces/${encodeURIComponent(podNamespace)}/pods/${encodeURIComponent(podName)}`;
      const restarts =
        item.status?.containerStatuses?.reduce(
          (total, container) => total + (container.restartCount ?? 0),
          0,
        ) ?? 0;
      const notReady =
        item.status?.containerStatuses
          ?.filter((container) => container.ready === false)
          .map((container) => container.name)
          .filter(Boolean) ?? [];

      return {
        id: evidenceId(spec.connectorId, sourceUri, podName),
        sourceUri,
        title: `Kubernetes pod: ${podNamespace}/${podName}`,
        summary: [
          `Phase ${item.status?.phase ?? 'unknown'}`,
          `${restarts} restart(s)`,
          notReady.length ? `Not ready: ${notReady.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join(' - '),
        evidenceType: 'topology',
        observedAt: item.status?.startTime ?? spec.timeWindow.end,
        resultHash: hashPayload(item),
      };
    }),
    spec.budget.maxRows,
  );
}

async function executeSentry(
  job: LeasedJob,
): Promise<ConnectorExecutionResult> {
  const spec = job.jobSpec;
  const endpoint = normalizedEndpoint(spec);
  const url = new URL(`${endpoint}/issues/`);
  url.searchParams.set('query', spec.query);
  url.searchParams.set('limit', String(Math.min(spec.budget.maxRows, 50)));
  const payload = await fetchJson(
    url.toString(),
    secretFromCredential(job),
    spec.budget.maxSeconds * 1000,
  );
  const issues = Array.isArray(payload) ? payload : [];

  return bounded(
    issues.map((issue) => {
      const item = issue as {
        id?: string;
        shortId?: string;
        title?: string;
        culprit?: string;
        permalink?: string;
        level?: string;
        status?: string;
        count?: string | number;
        firstSeen?: string;
        lastSeen?: string;
      };
      const title = item.title ?? item.shortId ?? item.id ?? 'Sentry issue';
      const sourceUri =
        item.permalink ??
        `${endpoint}/issues/${encodeURIComponent(item.id ?? title)}/`;
      const observedAt = item.lastSeen ?? item.firstSeen ?? spec.timeWindow.end;

      return {
        id: evidenceId(spec.connectorId, sourceUri, title),
        sourceUri,
        title: `Sentry issue: ${title}`,
        summary: [
          item.shortId,
          item.culprit,
          item.status,
          item.level,
          item.count ? `${item.count} event(s)` : null,
        ]
          .filter(Boolean)
          .join(' - '),
        evidenceType: 'event',
        observedAt,
        resultHash: hashPayload(item),
      };
    }),
    spec.budget.maxRows,
  );
}

function datadogHeaders(job: LeasedJob) {
  const apiKey = apiKeyFromCredential(job);
  const applicationKey = applicationKeyFromCredential(job);
  if (!apiKey || !applicationKey) {
    throw new Error(
      'Datadog connector requires apiKey and applicationKey credentials',
    );
  }

  return {
    'DD-API-KEY': apiKey,
    'DD-APPLICATION-KEY': applicationKey,
  };
}

async function executeDatadog(
  job: LeasedJob,
): Promise<ConnectorExecutionResult> {
  const spec = job.jobSpec;
  const endpoint = normalizedEndpoint(spec);
  const url = new URL(`${endpoint}/api/v1/events`);
  url.searchParams.set(
    'start',
    String(Math.floor(new Date(spec.timeWindow.start).getTime() / 1000)),
  );
  url.searchParams.set(
    'end',
    String(Math.floor(new Date(spec.timeWindow.end).getTime() / 1000)),
  );
  url.searchParams.set('unaggregated', 'true');
  if (spec.query.trim()) {
    url.searchParams.set('tags', spec.query.trim());
  }

  const payload = await fetchJson(
    url.toString(),
    null,
    spec.budget.maxSeconds * 1000,
    datadogHeaders(job),
  );
  const events = Array.isArray((payload as { events?: unknown[] }).events)
    ? (payload as { events: unknown[] }).events
    : [];

  return bounded(
    events.map((event) => {
      const item = event as {
        id?: number | string;
        title?: string;
        text?: string;
        date_happened?: number;
        alert_type?: string;
        source?: string;
        host?: string;
        tags?: string[];
        url?: string;
      };
      const title = item.title ?? `Datadog event ${item.id ?? 'unknown'}`;
      const sourceUri =
        item.url ??
        `${endpoint}/event/event?id=${encodeURIComponent(String(item.id ?? title))}`;

      return {
        id: evidenceId(spec.connectorId, sourceUri, title),
        sourceUri,
        title: `Datadog event: ${title}`,
        summary: [item.alert_type, item.source, item.host, item.text?.slice(0, 180)]
          .filter(Boolean)
          .join(' - '),
        evidenceType: 'event',
        observedAt: item.date_happened
          ? new Date(item.date_happened * 1000).toISOString()
          : spec.timeWindow.end,
        resultHash: hashPayload(item),
      };
    }),
    spec.budget.maxRows,
  );
}

async function executeLoki(job: LeasedJob): Promise<ConnectorExecutionResult> {
  const spec = job.jobSpec;
  const endpoint = normalizedEndpoint(spec);
  const url = new URL(`${endpoint}/loki/api/v1/query_range`);
  url.searchParams.set('query', spec.query);
  url.searchParams.set(
    'start',
    String(new Date(spec.timeWindow.start).getTime() * 1_000_000),
  );
  url.searchParams.set(
    'end',
    String(new Date(spec.timeWindow.end).getTime() * 1_000_000),
  );
  url.searchParams.set('limit', String(Math.min(spec.budget.maxRows, 100)));
  url.searchParams.set('direction', 'backward');

  const payload = await fetchJson(
    url.toString(),
    secretFromCredential(job),
    spec.budget.maxSeconds * 1000,
  );
  const streams = Array.isArray(
    (payload as { data?: { result?: unknown[] } }).data?.result,
  )
    ? (payload as { data: { result: unknown[] } }).data.result
    : [];
  const evidence: EvidenceSummary[] = [];

  for (const stream of streams) {
    const item = stream as {
      stream?: Record<string, string>;
      values?: Array<[string, string]>;
    };
    const labels = item.stream ?? {};
    const labelSummary = Object.entries(labels)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');

    for (const [timestampNs, line] of item.values ?? []) {
      if (evidence.length >= spec.budget.maxRows) {
        return bounded(evidence, spec.budget.maxRows);
      }

      const observedAt = dateFromUnixNs(timestampNs, spec.timeWindow.end);
      const titleLine = line.trim().slice(0, 160) || 'Loki log line';
      const sourceUri = `${endpoint}/loki/api/v1/query_range?query=${encodeURIComponent(spec.query)}&ts=${encodeURIComponent(timestampNs)}`;
      const severity = severityFromLogLine(line);

      evidence.push({
        id: evidenceId(spec.connectorId, sourceUri, titleLine),
        sourceUri,
        title: `Loki log: ${titleLine}`,
        summary: [labelSummary || `LogQL match for ${spec.query}`, severity]
          .filter(Boolean)
          .join(' - '),
        evidenceType: 'log',
        observedAt,
        resultHash: hashPayload({ labels, timestampNs, line }),
      });
    }
  }

  return bounded(evidence, spec.budget.maxRows);
}

async function executeElasticsearch(
  job: LeasedJob,
): Promise<ConnectorExecutionResult> {
  const spec = job.jobSpec;
  const endpoint = normalizedEndpoint(spec);
  const index =
    typeof spec.filters.index === 'string' && spec.filters.index.trim()
      ? spec.filters.index.trim()
      : null;
  const timestampField =
    typeof spec.filters.timestampField === 'string' &&
    spec.filters.timestampField.trim()
      ? spec.filters.timestampField.trim()
      : '@timestamp';
  const searchPath = index ? `/${encodeURIComponent(index)}/_search` : '/_search';
  const url = new URL(`${endpoint}${searchPath}`);
  url.searchParams.set(
    'q',
    `(${spec.query}) AND ${timestampField}:[${spec.timeWindow.start} TO ${spec.timeWindow.end}]`,
  );
  url.searchParams.set('size', String(Math.min(spec.budget.maxRows, 100)));
  url.searchParams.set('ignore_unavailable', 'true');
  url.searchParams.set('allow_no_indices', 'true');

  const payload = await fetchJson(
    url.toString(),
    secretFromCredential(job),
    spec.budget.maxSeconds * 1000,
  );
  const hits = Array.isArray(
    (payload as { hits?: { hits?: unknown[] } }).hits?.hits,
  )
    ? (payload as { hits: { hits: unknown[] } }).hits.hits
    : [];

  return bounded(
    hits.map((hit) => {
      const item = hit as {
        _id?: string;
        _index?: string;
        _score?: number;
        _source?: Record<string, unknown>;
      };
      const source = item._source ?? {};
      const message =
        sourceString(source, ['message', 'log', 'event.original', 'body']) ??
        JSON.stringify(source).slice(0, 500);
      const service = sourceString(source, [
        'service.name',
        'service',
        'app',
        'application',
      ]);
      const level = sourceString(source, ['log.level', 'level', 'severity']);
      const timestamp = sourceString(source, ['@timestamp', 'timestamp', 'time']);
      const observedAt = timestamp ? new Date(timestamp) : new Date(spec.timeWindow.end);
      const safeObservedAt = Number.isNaN(observedAt.getTime())
        ? spec.timeWindow.end
        : observedAt.toISOString();
      const titleLine =
        message.slice(0, 160) || item._id || 'Elasticsearch log document';
      const sourceUri = `${endpoint}/${encodeURIComponent(item._index ?? index ?? '_all')}/_doc/${encodeURIComponent(item._id ?? titleLine)}`;
      const severity = level ?? severityFromLogLine(message);

      return {
        id: evidenceId(spec.connectorId, sourceUri, titleLine),
        sourceUri,
        title: `Elasticsearch log: ${titleLine}`,
        summary: [
          item._index,
          service,
          severity,
          typeof item._score === 'number' ? `score ${item._score.toFixed(2)}` : null,
        ]
          .filter(Boolean)
          .join(' - '),
        evidenceType: 'log',
        observedAt: safeObservedAt,
        resultHash: hashPayload(item),
      };
    }),
    spec.budget.maxRows,
  );
}

async function executeTempo(job: LeasedJob): Promise<ConnectorExecutionResult> {
  const spec = job.jobSpec;
  const endpoint = normalizedEndpoint(spec);
  const normalizedQuery = normalizeTempoSearchQuery(spec.query);
  const url = new URL(`${endpoint}/api/search`);
  url.searchParams.set(
    'start',
    String(Math.floor(new Date(spec.timeWindow.start).getTime() / 1000)),
  );
  url.searchParams.set(
    'end',
    String(Math.floor(new Date(spec.timeWindow.end).getTime() / 1000)),
  );
  url.searchParams.set('limit', String(Math.min(spec.budget.maxRows, 100)));
  if (normalizedQuery.q) {
    url.searchParams.set('q', normalizedQuery.q);
  } else if (normalizedQuery.tags) {
    url.searchParams.set('tags', normalizedQuery.tags);
  }
  if (normalizedQuery.minDuration) {
    url.searchParams.set('minDuration', normalizedQuery.minDuration);
  }
  if (normalizedQuery.maxDuration) {
    url.searchParams.set('maxDuration', normalizedQuery.maxDuration);
  }

  const payload = await fetchJson(
    url.toString(),
    secretFromCredential(job),
    spec.budget.maxSeconds * 1000,
  );
  const traces = Array.isArray((payload as { traces?: unknown[] }).traces)
    ? (payload as { traces: unknown[] }).traces
    : [];

  return bounded(
    traces.map((trace) => {
      const item = trace as {
        traceID?: string;
        traceId?: string;
        rootServiceName?: string;
        rootTraceName?: string;
        serviceStats?: Record<string, unknown>;
        startTimeUnixNano?: string | number;
        durationMs?: number;
        spanSet?: { spans?: unknown[] };
        spanSets?: Array<{ spans?: unknown[] }>;
      };
      const traceId = item.traceID ?? item.traceId ?? 'unknown-trace';
      const rootService = item.rootServiceName ?? 'unknown-service';
      const rootName = item.rootTraceName ?? 'trace';
      const sourceUri = `${endpoint}/api/traces/${encodeURIComponent(traceId)}`;
      const serviceNames = Object.keys(item.serviceStats ?? {}).slice(0, 10);
      const spans = [
        ...(Array.isArray(item.spanSet?.spans) ? item.spanSet.spans : []),
        ...(item.spanSets ?? []).flatMap((spanSet) =>
          Array.isArray(spanSet.spans) ? spanSet.spans : [],
        ),
      ];
      const spanAttributes = spans
        .flatMap((span) => {
          if (!span || typeof span !== 'object' || Array.isArray(span)) {
            return [];
          }
          const attributes = (span as { attributes?: unknown[] }).attributes;
          if (!Array.isArray(attributes)) return [];
          return attributes
            .map((attribute) => {
              if (
                !attribute ||
                typeof attribute !== 'object' ||
                Array.isArray(attribute)
              ) {
                return null;
              }
              const entry = attribute as { key?: unknown; value?: unknown };
              const key = stringValue(entry.key);
              const value = tempoAttributeValue(entry.value);
              return key && value ? `${key}=${value}` : null;
            })
            .filter((attribute): attribute is string => Boolean(attribute));
        })
        .slice(0, 12);
      const duration = durationSummary(item.durationMs);

      return {
        id: evidenceId(spec.connectorId, sourceUri, traceId),
        sourceUri,
        title: `Tempo trace: ${rootService} ${rootName}`,
        summary: [
          traceId,
          duration ? `duration ${duration}` : null,
          serviceNames.length ? `services ${serviceNames.join(', ')}` : null,
          tempoTraceHasError(trace) ? 'error' : null,
          spanAttributes.length ? `attributes ${spanAttributes.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join(' - '),
        evidenceType: 'trace',
        observedAt: dateFromUnixNs(item.startTimeUnixNano, spec.timeWindow.end),
        resultHash: hashPayload(trace),
      };
    }),
    spec.budget.maxRows,
  );
}

async function executeCloudWatchAlarms(
  job: LeasedJob,
  query: CloudWatchQueryShape,
): Promise<ConnectorExecutionResult> {
  const spec = job.jobSpec;
  const endpoint = normalizedEndpoint(spec);
  const body: Record<string, string> = {
    Action: 'DescribeAlarms',
    MaxRecords: String(Math.min(spec.budget.maxRows, 100)),
  };
  const prefix = query.alarmPrefix ?? query.freeText;
  if (prefix && prefix !== '*') body.AlarmNamePrefix = prefix.slice(0, 255);
  if (
    query.stateValue &&
    ['OK', 'ALARM', 'INSUFFICIENT_DATA'].includes(query.stateValue)
  ) {
    body.StateValue = query.stateValue;
  }

  const xml = await cloudWatchRequest(job, body);
  const alarmsContainer = xmlBlocks(xml, 'MetricAlarms')[0] ?? '';
  const alarms = xmlBlocks(alarmsContainer, 'member');
  const region = cloudWatchRegion(endpoint, regionFromCredential(job));

  return bounded(
    alarms.map((alarm) => {
      const alarmName = xmlText(alarm, 'AlarmName') || 'CloudWatch alarm';
      const alarmArn = xmlText(alarm, 'AlarmArn');
      const stateValue = xmlText(alarm, 'StateValue');
      const metricName = xmlText(alarm, 'MetricName');
      const namespace = xmlText(alarm, 'Namespace');
      const stateUpdatedAt = xmlText(alarm, 'StateUpdatedTimestamp');
      const title = `CloudWatch alarm: ${alarmName}`;
      const sourceUri = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${awsEncode(region)}#alarmsV2:alarm/${awsEncode(alarmName)}`;
      const severity = cloudWatchSeverity(stateValue);

      return {
        id: evidenceId(spec.connectorId, alarmArn || sourceUri, title),
        sourceUri,
        title,
        summary: [
          stateValue || 'unknown state',
          severity,
          namespace && metricName ? `${namespace}/${metricName}` : null,
          xmlText(alarm, 'StateReason'),
        ]
          .filter(Boolean)
          .join(' - '),
        evidenceType: 'metric',
        observedAt: stateUpdatedAt || spec.timeWindow.end,
        resultHash: hashPayload(alarm),
      };
    }),
    spec.budget.maxRows,
  );
}

async function executeCloudWatchMetricData(
  job: LeasedJob,
  query: CloudWatchQueryShape,
): Promise<ConnectorExecutionResult> {
  const spec = job.jobSpec;
  if (!query.namespace || !query.metricName) {
    throw new Error('AWS CloudWatch metric queries require namespace and metric');
  }

  const endpoint = normalizedEndpoint(spec);
  const body: Record<string, string> = {
    Action: 'GetMetricData',
    StartTime: spec.timeWindow.start,
    EndTime: spec.timeWindow.end,
    MaxDatapoints: String(Math.min(Math.max(spec.budget.maxRows * 2, 1), 1000)),
    'MetricDataQueries.member.1.Id': 'm1',
    'MetricDataQueries.member.1.ReturnData': 'true',
    'MetricDataQueries.member.1.MetricStat.Metric.Namespace': query.namespace,
    'MetricDataQueries.member.1.MetricStat.Metric.MetricName': query.metricName,
    'MetricDataQueries.member.1.MetricStat.Period': String(query.periodSeconds),
    'MetricDataQueries.member.1.MetricStat.Stat': query.statistic,
  };

  query.dimensions.slice(0, 10).forEach((dimension, index) => {
    const position = index + 1;
    body[
      `MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.${position}.Name`
    ] = dimension.name;
    body[
      `MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.${position}.Value`
    ] = dimension.value;
  });

  const xml = await cloudWatchRequest(job, body);
  const resultsContainer = xmlBlocks(xml, 'MetricDataResults')[0] ?? '';
  const results = xmlBlocks(resultsContainer, 'member');
  const region = cloudWatchRegion(endpoint, regionFromCredential(job));

  return bounded(
    results.map((result) => {
      const label = xmlText(result, 'Label') || `${query.namespace}/${query.metricName}`;
      const values = xmlMemberValues(result, 'Values').slice(0, spec.budget.maxRows);
      const timestamps = xmlMemberValues(result, 'Timestamps').slice(
        0,
        spec.budget.maxRows,
      );
      const latestValue = values[0];
      const latestTimestamp = timestamps[0];
      const title = `CloudWatch metric: ${label}`;
      const sourceUri = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${awsEncode(region)}#metricsV2`;

      return {
        id: evidenceId(spec.connectorId, sourceUri, title),
        sourceUri,
        title,
        summary: [
          `${values.length} datapoint${values.length === 1 ? '' : 's'}`,
          latestValue ? `latest ${latestValue}` : null,
          query.dimensions.length
            ? query.dimensions
                .map((dimension) => `${dimension.name}=${dimension.value}`)
                .join(', ')
            : null,
        ]
          .filter(Boolean)
          .join(' - '),
        evidenceType: 'metric',
        observedAt: latestTimestamp || spec.timeWindow.end,
        resultHash: hashPayload(result),
      };
    }),
    spec.budget.maxRows,
  );
}

async function executeCloudWatch(
  job: LeasedJob,
): Promise<ConnectorExecutionResult> {
  const query = parseCloudWatchQuery(job.jobSpec.query);
  if (query.namespace && query.metricName) {
    return executeCloudWatchMetricData(job, query);
  }

  return executeCloudWatchAlarms(job, query);
}

export async function executePrivateAgentConnectorJob(
  job: LeasedJob,
): Promise<ConnectorExecutionResult> {
  switch (job.jobSpec.connectorType) {
    case 'github':
      return executeGitHub(job);
    case 'prometheus':
      return executePrometheus(job);
    case 'grafana':
      return executeGrafana(job);
    case 'kubernetes':
      return executeKubernetes(job);
    case 'sentry':
      return executeSentry(job);
    case 'datadog':
      return executeDatadog(job);
    case 'loki':
      return executeLoki(job);
    case 'elasticsearch':
      return executeElasticsearch(job);
    case 'tempo':
      return executeTempo(job);
    case 'aws_cloudwatch':
      return executeCloudWatch(job);
  }
}

function readConfig(): PrivateAgentConfig {
  const apiUrl = process.env.SUPERCHECK_API_URL?.replace(/\/$/, '');
  const agentId = process.env.PRIVATE_AGENT_ID;
  const credentialFile =
    process.env.PRIVATE_AGENT_CREDENTIAL_FILE?.trim() || null;
  const persistedToken = credentialFile
    ? readCredentialFile(credentialFile)
    : null;
  const token = persistedToken ?? process.env.PRIVATE_AGENT_TOKEN;

  if (!apiUrl || !agentId || !token) {
    throw new Error(
      'Private Agent mode requires SUPERCHECK_API_URL, PRIVATE_AGENT_ID, and PRIVATE_AGENT_TOKEN',
    );
  }

  return {
    apiUrl,
    agentId,
    token,
    tokenSource: persistedToken ? 'file' : 'env',
    credentialFile,
    agentVersion:
      process.env.PRIVATE_AGENT_VERSION ??
      process.env.npm_package_version ??
      '1.3.5',
    retryIntervalMs: Number(
      process.env.PRIVATE_AGENT_RETRY_INTERVAL_MS ??
        process.env.PRIVATE_AGENT_POLL_INTERVAL_MS ??
        DEFAULT_RETRY_INTERVAL_MS,
    ),
    leaseWaitMs: Number(
      process.env.PRIVATE_AGENT_LEASE_WAIT_MS ?? DEFAULT_LEASE_WAIT_MS,
    ),
    heartbeatIntervalMs: Number(
      process.env.PRIVATE_AGENT_HEARTBEAT_INTERVAL_MS ??
        DEFAULT_HEARTBEAT_INTERVAL_MS,
    ),
  };
}

function readCredentialFile(filePath: string) {
  if (!existsSync(filePath)) {
    return null;
  }

  const token = readFileSync(filePath, 'utf8').trim();
  return token.length > 0 ? token : null;
}

function writeCredentialFile(filePath: string, token: string) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function postJson(
  config: PrivateAgentConfig,
  path: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}`);
  }

  return response.json();
}

export async function exchangeRegistrationToken(
  config: PrivateAgentConfig,
): Promise<PrivateAgentConfig> {
  if (config.tokenSource === 'file') {
    return config;
  }

  const response = await fetch(
    `${config.apiUrl}/api/private-agents/registration/exchange`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        agentId: config.agentId,
        protocolVersion: PROTOCOL_VERSION,
        agentVersion: config.agentVersion,
        capabilities: privateAgentCapabilities(),
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (response.status === 401) {
    return config;
  }

  if (!response.ok) {
    throw new Error(
      `/api/private-agents/registration/exchange failed with HTTP ${response.status}`,
    );
  }

  const exchanged = registrationExchangeResponseSchema.parse(
    await response.json(),
  );

  if (config.credentialFile) {
    writeCredentialFile(config.credentialFile, exchanged.token);
  }

  return {
    ...config,
    token: exchanged.token,
    tokenSource: config.credentialFile ? 'file' : 'env',
  };
}

async function sendHeartbeat(
  config: PrivateAgentConfig,
  status: 'connected' | 'unhealthy',
  activeJobCount: number,
  errorCode?: string,
) {
  const startedAt = Date.now();
  await postJson(config, '/api/private-agents/heartbeat', {
    agentId: config.agentId,
    status,
    protocolVersion: PROTOCOL_VERSION,
    agentVersion: config.agentVersion,
    activeJobCount,
    latencyMs: Date.now() - startedAt,
    errorCode,
    capabilities: {
      ...privateAgentCapabilities(),
    },
  });
}

async function leaseJob(
  config: PrivateAgentConfig,
): Promise<{ job: LeasedJob; leaseToken: string } | null> {
  const payload = leaseResponseSchema.parse(
    await postJson(config, '/api/private-agents/jobs/lease', {
      waitMs: config.leaseWaitMs,
    }),
  );
  if (!payload.job) return null;
  if (!payload.leaseToken)
    throw new Error('Lease response omitted lease token');
  return { job: payload.job, leaseToken: payload.leaseToken };
}

async function submitResult(
  config: PrivateAgentConfig,
  leased: { job: LeasedJob; leaseToken: string },
  status: 'completed' | 'failed',
  result?: ConnectorExecutionResult,
  errorCode?: string,
) {
  await postJson(config, '/api/private-agents/jobs/result', {
    jobId: leased.job.id,
    leaseToken: leased.leaseToken,
    status,
    resultHash: result?.resultHash,
    evidence: result?.evidence ?? [],
    truncated: result?.truncated ?? false,
    errorCode,
  });
}

export async function startPrivateAgentRunner(): Promise<void> {
  const config = await exchangeRegistrationToken(readConfig());
  let activeJobCount = 0;
  let lastError: string | undefined;

  console.log(
    `Private Agent mode started for ${config.agentId}; long-polling ${config.apiUrl}`,
  );
  await sendHeartbeat(config, 'connected', activeJobCount);
  setInterval(() => {
    void sendHeartbeat(
      config,
      lastError ? 'unhealthy' : 'connected',
      activeJobCount,
      lastError,
    ).catch((error) => {
      console.warn(
        `Private Agent heartbeat failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }, config.heartbeatIntervalMs);

  for (;;) {
    try {
      const leased = await leaseJob(config);
      if (!leased) {
        if (config.leaseWaitMs <= 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, config.retryIntervalMs),
          );
        }
        continue;
      }

      activeJobCount = 1;
      try {
        const result = await executePrivateAgentConnectorJob(leased.job);
        await submitResult(config, leased, 'completed', result);
      } catch (error) {
        const errorCode =
          error instanceof Error
            ? error.message.slice(0, 100)
            : 'private_agent_job_error';
        await submitResult(config, leased, 'failed', undefined, errorCode);
        throw error;
      }
      activeJobCount = 0;
      lastError = undefined;
    } catch (error) {
      activeJobCount = 0;
      lastError =
        error instanceof Error
          ? error.message.slice(0, 100)
          : 'private_agent_error';
      console.warn(`Private Agent job loop failed: ${lastError}`);
      await new Promise((resolve) =>
        setTimeout(resolve, config.retryIntervalMs),
      );
    }
  }
}
