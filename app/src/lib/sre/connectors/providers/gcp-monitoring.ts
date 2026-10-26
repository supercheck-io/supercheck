// Shared with the Private Agent worker; see provider-core.ts.
import { createSign } from 'node:crypto';
import {
  asArray,
  assertVendorUrl,
  boundedJson,
  clampInt,
  credentialText,
  isRecord,
  nowMs,
  readAccessToken,
  readCachedToken,
  requestJson,
  rowLimit,
  severityFromText,
  sha256Hex,
  stringOf,
  summarizeFields,
  toIso,
  writeCachedToken,
  PROVIDER_MAX_RESPONSE_BYTES,
  type ProviderContext,
  type ProviderRecord,
  type ProviderResult,
  type ProviderSearchParams,
} from './provider-core';

const PROVIDER = 'Google Cloud';
// Fixed: never read from the key file, whose token_uri is user supplied.
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE =
  'https://www.googleapis.com/auth/monitoring.read https://www.googleapis.com/auth/logging.read';
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9.:-]{3,60}[a-z0-9]$/;
const CLIENT_EMAIL_PATTERN = /^[^@\s]+@[a-z0-9.-]+\.gserviceaccount\.com$/i;

export type GcpServiceAccount = {
  clientEmail: string;
  privateKey: string;
  privateKeyId: string | null;
  projectId: string;
};

export function parseGcpCredential(
  credential: ProviderContext['credential'],
): GcpServiceAccount {
  const raw = credentialText(credential, [
    'serviceAccountJson',
    'service_account_json',
    'secret',
  ]);
  if (!raw) {
    throw new Error(
      'invalid credentials: Google Cloud requires a service account JSON key',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'invalid credentials: the Google Cloud service account key is not valid JSON',
    );
  }
  // Rejects authorized_user and external_account (workload identity) files,
  // which can make the client fetch attacker-chosen URLs.
  if (!isRecord(parsed) || parsed.type !== 'service_account') {
    throw new Error(
      'invalid credentials: the key must be a service_account JSON key',
    );
  }
  const clientEmail = stringOf(parsed.client_email, 200);
  const privateKey = stringOf(parsed.private_key, 8192);
  if (
    !clientEmail ||
    !CLIENT_EMAIL_PATTERN.test(clientEmail) ||
    !privateKey ||
    !privateKey.includes('PRIVATE KEY')
  ) {
    throw new Error(
      'invalid credentials: the service account key is missing client_email or private_key',
    );
  }
  const projectId =
    credentialText(credential, ['projectId', 'project_id']) ??
    stringOf(parsed.project_id, 100);
  if (!projectId || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error(
      'invalid credentials: set a valid Google Cloud project ID on the connector',
    );
  }
  return {
    clientEmail,
    privateKey,
    privateKeyId: stringOf(parsed.private_key_id, 100),
    projectId,
  };
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function signGcpJwt(
  account: GcpServiceAccount,
  issuedAtSeconds: number,
) {
  const header = base64Url(
    JSON.stringify({
      alg: 'RS256',
      typ: 'JWT',
      ...(account.privateKeyId ? { kid: account.privateKeyId } : {}),
    }),
  );
  const claims = base64Url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: issuedAtSeconds,
      exp: issuedAtSeconds + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  let signature: Buffer;
  try {
    signature = signer.sign(account.privateKey);
  } catch {
    throw new Error(
      'invalid credentials: the service account private key could not sign a token',
    );
  }
  return `${header}.${claims}.${base64Url(signature)}`;
}

async function accessToken(ctx: ProviderContext, account: GcpServiceAccount) {
  const now = nowMs(ctx);
  const cacheKey = `gcp:${sha256Hex(`${account.clientEmail}:${account.privateKey}`)}`;
  const cached = readCachedToken(cacheKey, now);
  if (cached) return cached;

  assertVendorUrl(TOKEN_URL);
  const response = await ctx.http({
    url: TOKEN_URL,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signGcpJwt(account, Math.floor(now / 1000)),
    }).toString(),
    timeoutMs: 10_000,
    maxBytes: 64 * 1024,
    target: 'vendor',
  });
  const { token, expiresIn } = readAccessToken(PROVIDER, response);
  writeCachedToken(cacheKey, token, expiresIn, now);
  return token;
}

function authHeaders(token: string, json = false): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

export async function validateGcp(ctx: ProviderContext) {
  const account = parseGcpCredential(ctx.credential);
  const token = await accessToken(ctx, account);
  const project = encodeURIComponent(account.projectId);
  let monitoringError: unknown;
  try {
    await requestJson(ctx, PROVIDER, {
      url: `https://monitoring.googleapis.com/v3/projects/${project}/metricDescriptors?pageSize=1`,
      method: 'GET',
      headers: authHeaders(token),
      timeoutMs: 10_000,
      maxBytes: PROVIDER_MAX_RESPONSE_BYTES,
      target: 'vendor',
    });
    return;
  } catch (error) {
    monitoringError = error;
  }
  // A key limited to Logging Viewer is still a valid connector.
  try {
    await requestJson(ctx, PROVIDER, {
      url: 'https://logging.googleapis.com/v2/entries:list',
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify({
        resourceNames: [`projects/${account.projectId}`],
        pageSize: 1,
      }),
      timeoutMs: 10_000,
      maxBytes: PROVIDER_MAX_RESPONSE_BYTES,
      target: 'vendor',
    });
  } catch {
    throw monitoringError;
  }
}

export type GcpQuery = { kind: 'metrics' | 'logs'; filter: string };

export function parseGcpQuery(query: string): GcpQuery {
  const trimmed = query.trim();
  const prefixed = /^(metrics|logs)\s*:\s*([\s\S]*)$/i.exec(trimmed);
  const kind = prefixed
    ? (prefixed[1].toLowerCase() as 'metrics' | 'logs')
    : /\bmetric\.type\b/.test(trimmed)
      ? 'metrics'
      : 'logs';
  const filter = (prefixed ? prefixed[2] : trimmed).trim();
  if (kind === 'metrics' && !/\bmetric\.type\b/.test(filter)) {
    throw new Error(
      'Google Cloud metric queries need a filter with metric.type, for example metrics: metric.type="run.googleapis.com/request_count"',
    );
  }
  if (filter.length > 800) throw new Error('Google Cloud filter is too long');
  if (!hasBalancedParentheses(filter)) {
    throw new Error('Google Cloud filter has unbalanced parentheses');
  }
  return { kind, filter: filter === '*' ? '' : filter };
}

/** Prevents "x) OR (y" from escaping the parentheses that scope the time window. */
export function hasBalancedParentheses(filter: string) {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < filter.length; index += 1) {
    const char = filter[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && quote === null;
}

function pointNumber(point: unknown): number | null {
  if (!isRecord(point) || !isRecord(point.value)) return null;
  const value = point.value;
  const candidate = value.doubleValue ?? value.int64Value;
  const numeric = typeof candidate === 'string' ? Number(candidate) : candidate;
  return typeof numeric === 'number' && Number.isFinite(numeric)
    ? numeric
    : null;
}

async function searchMetrics(
  ctx: ProviderContext,
  account: GcpServiceAccount,
  token: string,
  filter: string,
  params: ProviderSearchParams,
): Promise<ProviderResult> {
  const limit = rowLimit(params);
  const url = new URL(
    `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(account.projectId)}/timeSeries`,
  );
  url.searchParams.set('filter', filter);
  url.searchParams.set(
    'interval.startTime',
    params.timeWindow.start.toISOString(),
  );
  url.searchParams.set('interval.endTime', params.timeWindow.end.toISOString());
  url.searchParams.set('view', 'FULL');
  url.searchParams.set('pageSize', String(Math.min(limit + 1, 100)));
  const payload = await requestJson(ctx, PROVIDER, {
    url: url.toString(),
    method: 'GET',
    headers: authHeaders(token),
    timeoutMs: params.maxSeconds * 1000,
    maxBytes: PROVIDER_MAX_RESPONSE_BYTES,
    target: 'vendor',
  });
  const series = (
    isRecord(payload) && Array.isArray(payload.timeSeries)
      ? payload.timeSeries
      : []
  ).filter(isRecord);

  const records = series.slice(0, limit).map((entry): ProviderRecord => {
    const metric = isRecord(entry.metric) ? entry.metric : {};
    const resource = isRecord(entry.resource) ? entry.resource : {};
    const points = asArray(entry.points).slice(0, 1000);
    const values = points
      .map(pointNumber)
      .filter((value): value is number => value !== null);
    const first = points[points.length - 1];
    const last = points[0];
    const stats = values.length
      ? {
          points: values.length,
          latest: values[0],
          min: Math.min(...values),
          max: Math.max(...values),
          avg: values.reduce((sum, value) => sum + value, 0) / values.length,
        }
      : { points: points.length };
    const labels = {
      ...(isRecord(resource.labels) ? resource.labels : {}),
      ...(isRecord(metric.labels) ? metric.labels : {}),
    };
    const lastInterval =
      isRecord(last) && isRecord(last.interval) ? last.interval : {};
    const type = stringOf(metric.type, 200) ?? 'metric';
    return {
      title: `Google Cloud metric: ${type}`,
      summary: [
        summarizeFields(labels, 6, 60),
        values.length
          ? `latest ${stats.latest} · min ${(stats as { min: number }).min} · max ${(stats as { max: number }).max} · ${values.length} points`
          : `${points.length} points`,
      ]
        .filter(Boolean)
        .join(' · '),
      rawContent: boundedJson({
        metric: type,
        resourceType: resource.type,
        labels,
        metricKind: entry.metricKind,
        valueType: entry.valueType,
        stats,
        firstPointAt:
          isRecord(first) && isRecord(first.interval)
            ? first.interval.endTime
            : undefined,
      }),
      evidenceType: 'metric',
      observedAt: toIso(lastInterval.endTime, params.timeWindow.end),
      tags: [
        'gcp',
        'metric',
        type,
        ...Object.entries(labels)
          .slice(0, 8)
          .map(([k, v]) => `${k}:${stringOf(v, 60)}`),
      ],
      sourceUri: `https://console.cloud.google.com/monitoring/metrics-explorer?project=${encodeURIComponent(account.projectId)}`,
      hashInput: { type, labels, stats },
    };
  });
  return { records, truncated: series.length > records.length };
}

const LOG_SEVERITY: Record<string, string> = {
  DEBUG: 'info',
  INFO: 'info',
  NOTICE: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
  ALERT: 'critical',
  EMERGENCY: 'critical',
};

async function searchLogs(
  ctx: ProviderContext,
  account: GcpServiceAccount,
  token: string,
  filter: string,
  params: ProviderSearchParams,
): Promise<ProviderResult> {
  const limit = rowLimit(params);
  const window = `timestamp>="${params.timeWindow.start.toISOString()}" AND timestamp<="${params.timeWindow.end.toISOString()}"`;
  const payload = await requestJson(ctx, PROVIDER, {
    url: 'https://logging.googleapis.com/v2/entries:list',
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({
      resourceNames: [`projects/${account.projectId}`],
      filter: filter ? `(${filter}) AND ${window}` : window,
      orderBy: 'timestamp desc',
      pageSize: clampInt(limit + 1, 1, 101),
    }),
    timeoutMs: params.maxSeconds * 1000,
    maxBytes: PROVIDER_MAX_RESPONSE_BYTES,
    target: 'vendor',
  });
  const entries = (
    isRecord(payload) && Array.isArray(payload.entries) ? payload.entries : []
  ).filter(isRecord);

  const records = entries.slice(0, limit).map((entry): ProviderRecord => {
    const json = isRecord(entry.jsonPayload) ? entry.jsonPayload : null;
    const proto = isRecord(entry.protoPayload) ? entry.protoPayload : null;
    const protoStatus = proto && isRecord(proto.status) ? proto.status : null;
    const message =
      stringOf(entry.textPayload, 4000) ??
      stringOf(json?.message ?? json?.msg ?? json?.error, 4000) ??
      stringOf(protoStatus?.message, 4000) ??
      stringOf(proto?.methodName, 200) ??
      'log entry';
    const resource = isRecord(entry.resource) ? entry.resource : {};
    const severity = stringOf(entry.severity, 20)?.toUpperCase();
    const logName = stringOf(entry.logName, 200)?.split('/').pop();
    return {
      title: `Google Cloud log: ${message.slice(0, 160)}`,
      summary: [
        severity,
        stringOf(resource.type, 80),
        isRecord(resource.labels)
          ? summarizeFields(resource.labels, 4, 50)
          : null,
        logName,
      ]
        .filter(Boolean)
        .join(' · '),
      rawContent: boundedJson(
        { message, payload: json ?? undefined, httpRequest: entry.httpRequest },
        3000,
      ),
      evidenceType: 'log',
      observedAt: toIso(
        entry.timestamp ?? entry.receiveTimestamp,
        params.timeWindow.end,
      ),
      severity:
        (severity && LOG_SEVERITY[severity]) ?? severityFromText(message),
      tags: [
        'gcp',
        'log',
        ...(severity ? [`severity:${severity}`] : []),
        ...(stringOf(resource.type, 60)
          ? [`resource:${stringOf(resource.type, 60)}`]
          : []),
      ],
      sourceUri: `https://console.cloud.google.com/logs/query?project=${encodeURIComponent(account.projectId)}`,
      hashInput: {
        insertId: entry.insertId,
        timestamp: entry.timestamp,
        message,
      },
    };
  });
  return { records, truncated: entries.length > records.length };
}

export async function searchGcp(
  ctx: ProviderContext,
  params: ProviderSearchParams,
): Promise<ProviderResult> {
  const query = parseGcpQuery(params.query);
  const account = parseGcpCredential(ctx.credential);
  const token = await accessToken(ctx, account);
  return query.kind === 'metrics'
    ? searchMetrics(ctx, account, token, query.filter, params)
    : searchLogs(ctx, account, token, query.filter, params);
}
