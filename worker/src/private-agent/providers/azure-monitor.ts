// Shared with the Private Agent worker; see provider-core.ts.
import {
  assertVendorUrl,
  boundedJson,
  clampInt,
  credentialText,
  isRecord,
  nowMs,
  parseKeyValueTokens,
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
  type ProviderEvidenceType,
  type ProviderRecord,
  type ProviderResult,
  type ProviderSearchParams,
} from './provider-core';

const PROVIDER = 'Azure Monitor';
const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9][a-z0-9.-]{1,100}\.[a-z]{2,})$/i;
const RESOURCE_ID_PATTERN =
  /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[\w.()-]+\/providers\/[\w.]+(?:\/[\w.()-]+){2,}$/i;
const ARM_SCOPE = 'https://management.azure.com/.default';
const LOGS_SCOPE = 'https://api.loganalytics.azure.com/.default';
const AGGREGATIONS = ['Average', 'Count', 'Maximum', 'Minimum', 'Total'];
const INTERVAL_PATTERN = /^(?:PT\d{1,3}[MH]|P1D)$/;
const KQL_BLOCKED =
  /\b(?:externaldata|http_request|http_request_post|sql_request|cosmosdb_sql_request|ingest|infer_storage_schema)\b|\b(?:workspace|app|resource|cluster|database|adx)\s*\(|\bevaluate\s+(?:mysql_request|azure_digital_twins_query_request|ai_\w+)/i;

export type AzureCredential = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  workspaceId: string | null;
};

export function parseAzureCredential(
  credential: ProviderContext['credential'],
): AzureCredential {
  const tenantId = credentialText(credential, ['tenantId', 'tenant_id']);
  const clientId = credentialText(credential, ['clientId', 'client_id']);
  const clientSecret = credentialText(credential, ['secret', 'clientSecret']);
  const workspaceId = credentialText(credential, [
    'workspaceId',
    'workspace_id',
  ]);
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'invalid credentials: Azure Monitor requires a tenant ID, client ID and client secret',
    );
  }
  if (!TENANT_PATTERN.test(tenantId)) {
    throw new Error('invalid credentials: the Azure tenant ID is not valid');
  }
  if (!GUID_PATTERN.test(clientId)) {
    throw new Error('invalid credentials: the Azure client ID must be a GUID');
  }
  if (workspaceId && !GUID_PATTERN.test(workspaceId)) {
    throw new Error(
      'invalid credentials: the Log Analytics workspace ID must be a GUID',
    );
  }
  return { tenantId, clientId, clientSecret, workspaceId };
}

async function accessToken(
  ctx: ProviderContext,
  credential: AzureCredential,
  scope: string,
) {
  const now = nowMs(ctx);
  const cacheKey = `azure:${sha256Hex(`${credential.tenantId}:${credential.clientId}:${credential.clientSecret}:${scope}`)}`;
  const cached = readCachedToken(cacheKey, now);
  if (cached) return cached;

  const url = `https://login.microsoftonline.com/${encodeURIComponent(credential.tenantId)}/oauth2/v2.0/token`;
  assertVendorUrl(url);
  const response = await ctx.http({
    url,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credential.clientId,
      client_secret: credential.clientSecret,
      scope,
    }).toString(),
    timeoutMs: 10_000,
    maxBytes: 64 * 1024,
    target: 'vendor',
  });
  const { token, expiresIn } = readAccessToken(PROVIDER, response);
  writeCachedToken(cacheKey, token, expiresIn, now);
  return token;
}

export async function validateAzure(ctx: ProviderContext) {
  const credential = parseAzureCredential(ctx.credential);
  await accessToken(ctx, credential, ARM_SCOPE);
  if (!credential.workspaceId) return;
  const logs = await accessToken(ctx, credential, LOGS_SCOPE);
  await requestJson(ctx, PROVIDER, {
    url: `https://api.loganalytics.azure.com/v1/workspaces/${credential.workspaceId}/query`,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${logs}`,
    },
    body: JSON.stringify({ query: 'print ok=1', timespan: 'PT5M' }),
    timeoutMs: 10_000,
    maxBytes: PROVIDER_MAX_RESPONSE_BYTES,
    target: 'vendor',
  });
}

/** Rejects control commands and constructs that read outside the workspace. */
export function assertReadOnlyKql(query: string) {
  const trimmed = query.trim();
  if (!trimmed) throw new Error('KQL query is empty');
  if (/(?:^|[\n;])\s*\./.test(trimmed)) {
    throw new Error(
      'KQL control commands (starting with ".") are not allowed: connectors are read-only',
    );
  }
  const blocked = KQL_BLOCKED.exec(trimmed);
  if (blocked) {
    throw new Error(
      `KQL "${blocked[0].toLowerCase()}" is not allowed: it reads or writes outside the configured workspace`,
    );
  }
}

export type AzureQuery =
  | { kind: 'logs'; kql: string }
  | {
      kind: 'metrics';
      resource: string;
      names: string[];
      aggregations: string[];
      interval: string | null;
    };

export function parseAzureQuery(query: string): AzureQuery {
  const trimmed = query.trim();
  const metrics = /^metrics\s*:\s*([\s\S]*)$/i.exec(trimmed);
  if (metrics) {
    const { values } = parseKeyValueTokens(metrics[1], '=');
    const resource = values.resource ?? '';
    if (!RESOURCE_ID_PATTERN.test(resource) || resource.includes('..')) {
      throw new Error(
        'Azure metric queries need resource=/subscriptions/<id>/resourceGroups/<rg>/providers/<type>/<name>',
      );
    }
    const names = (values.names ?? values.metric ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    if (
      !names.length ||
      names.length > 5 ||
      names.some((name) => !/^[\w .%/()-]{1,100}$/.test(name))
    ) {
      throw new Error(
        'Azure metric queries need names="Metric A,Metric B" (up to 5)',
      );
    }
    const aggregations = (values.agg ?? 'Average')
      .split(',')
      .map((agg) => agg.trim())
      .filter(Boolean);
    if (
      !aggregations.length ||
      aggregations.some((agg) => !AGGREGATIONS.includes(agg))
    ) {
      throw new Error(
        `Azure metric aggregation must be one of ${AGGREGATIONS.join(', ')}`,
      );
    }
    if (values.interval && !INTERVAL_PATTERN.test(values.interval)) {
      throw new Error(
        'Azure metric interval must look like PT1M, PT5M, PT1H or P1D',
      );
    }
    return {
      kind: 'metrics',
      resource,
      names,
      aggregations,
      interval: values.interval ?? null,
    };
  }
  const kql = (/^logs\s*:\s*([\s\S]*)$/i.exec(trimmed)?.[1] ?? trimmed).trim();
  assertReadOnlyKql(kql);
  return { kind: 'logs', kql };
}

function defaultInterval(window: { start: Date; end: Date }) {
  const minutes = (window.end.getTime() - window.start.getTime()) / 60_000;
  return minutes <= 60 ? 'PT1M' : minutes <= 360 ? 'PT5M' : 'PT15M';
}

async function searchMetrics(
  ctx: ProviderContext,
  credential: AzureCredential,
  query: Extract<AzureQuery, { kind: 'metrics' }>,
  params: ProviderSearchParams,
): Promise<ProviderResult> {
  const token = await accessToken(ctx, credential, ARM_SCOPE);
  const url = new URL(
    `https://management.azure.com${query.resource}/providers/microsoft.insights/metrics`,
  );
  url.searchParams.set('api-version', '2018-01-01');
  url.searchParams.set('metricnames', query.names.join(','));
  url.searchParams.set(
    'timespan',
    `${params.timeWindow.start.toISOString()}/${params.timeWindow.end.toISOString()}`,
  );
  url.searchParams.set(
    'interval',
    query.interval ?? defaultInterval(params.timeWindow),
  );
  url.searchParams.set('aggregation', query.aggregations.join(','));
  const payload = await requestJson(ctx, PROVIDER, {
    url: url.toString(),
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    timeoutMs: params.maxSeconds * 1000,
    maxBytes: PROVIDER_MAX_RESPONSE_BYTES,
    target: 'vendor',
  });
  const limit = rowLimit(params);
  const records: ProviderRecord[] = [];
  let total = 0;
  const metrics = (
    isRecord(payload) && Array.isArray(payload.value) ? payload.value : []
  ).filter(isRecord);
  for (const metric of metrics) {
    const name = isRecord(metric.name)
      ? stringOf(metric.name.value, 120)
      : null;
    const unit = stringOf(metric.unit, 40);
    for (const series of (Array.isArray(metric.timeseries)
      ? metric.timeseries
      : []
    ).filter(isRecord)) {
      total += 1;
      if (records.length >= limit) continue;
      const data = (Array.isArray(series.data) ? series.data : [])
        .filter(isRecord)
        .slice(0, 1000);
      const stats: Record<
        string,
        { latest: number; min: number; max: number; avg: number }
      > = {};
      for (const agg of query.aggregations) {
        const field = agg === 'Total' ? 'total' : agg.toLowerCase();
        const values = data
          .map((point) => point[field])
          .filter(
            (value): value is number =>
              typeof value === 'number' && Number.isFinite(value),
          );
        if (!values.length) continue;
        stats[agg] = {
          latest: values[values.length - 1],
          min: Math.min(...values),
          max: Math.max(...values),
          avg: values.reduce((sum, value) => sum + value, 0) / values.length,
        };
      }
      const dimensions = (
        Array.isArray(series.metadatavalues) ? series.metadatavalues : []
      )
        .filter(isRecord)
        .map(
          (entry) =>
            `${isRecord(entry.name) ? stringOf(entry.name.value, 60) : ''}=${stringOf(entry.value, 80) ?? ''}`,
        )
        .slice(0, 5);
      const lastPoint = data[data.length - 1];
      records.push({
        title: `Azure metric: ${name ?? 'metric'}${unit ? ` (${unit})` : ''}`,
        summary: [
          ...dimensions,
          ...Object.entries(stats).map(
            ([agg, s]) => `${agg} latest ${s.latest} min ${s.min} max ${s.max}`,
          ),
          `${data.length} points`,
        ].join(' · '),
        rawContent: boundedJson({
          metric: name,
          unit,
          resource: query.resource,
          dimensions,
          stats,
        }),
        evidenceType: 'metric',
        observedAt: toIso(lastPoint?.timeStamp, params.timeWindow.end),
        tags: ['azure', 'metric', ...(name ? [name] : [])],
        sourceUri: `https://portal.azure.com/#@${encodeURIComponent(credential.tenantId)}/resource${query.resource}/metrics`,
        hashInput: { name, dimensions, stats },
      });
    }
  }
  return { records, truncated: total > records.length };
}

const TEXT_COLUMNS = [
  'Message',
  'message',
  'ResultDescription',
  'RenderedDescription',
  'ExceptionMessage',
  'OuterMessage',
  'Log_s',
  'LogMessage_s',
];

async function searchLogs(
  ctx: ProviderContext,
  credential: AzureCredential,
  query: Extract<AzureQuery, { kind: 'logs' }>,
  params: ProviderSearchParams,
): Promise<ProviderResult> {
  if (!credential.workspaceId) {
    throw new Error(
      'invalid credentials: set a Log Analytics workspace ID on the connector to run KQL queries',
    );
  }
  const token = await accessToken(ctx, credential, LOGS_SCOPE);
  const limit = rowLimit(params);
  const kql = `${query.kql.replace(/[\s;]+$/, '')}\n| take ${limit + 1}`;
  const payload = await requestJson(ctx, PROVIDER, {
    url: `https://api.loganalytics.azure.com/v1/workspaces/${credential.workspaceId}/query`,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Prefer: `wait=${clampInt(params.maxSeconds, 1, 60)}`,
    },
    body: JSON.stringify({
      query: kql,
      timespan: `${params.timeWindow.start.toISOString()}/${params.timeWindow.end.toISOString()}`,
    }),
    timeoutMs: params.maxSeconds * 1000,
    maxBytes: PROVIDER_MAX_RESPONSE_BYTES,
    target: 'vendor',
  });
  const table =
    isRecord(payload) && Array.isArray(payload.tables)
      ? payload.tables.find(isRecord)
      : undefined;
  const columns = (
    isRecord(table) && Array.isArray(table.columns) ? table.columns : []
  ).map((column) => (isRecord(column) ? stringOf(column.name, 80) : null));
  const rows =
    isRecord(table) && Array.isArray(table.rows)
      ? (table.rows as unknown[])
      : [];
  const textColumn = columns.find(
    (name) => name && TEXT_COLUMNS.includes(name),
  );
  const hasTime = columns.includes('TimeGenerated');
  const type: ProviderEvidenceType = textColumn
    ? 'log'
    : hasTime
      ? 'event'
      : 'metric';

  const records = rows.slice(0, limit).map((row): ProviderRecord => {
    const values = Array.isArray(row) ? row : [];
    const record: Record<string, unknown> = {};
    columns.forEach((name, index) => {
      if (name) record[name] = values[index];
    });
    const message = textColumn ? stringOf(record[textColumn], 4000) : null;
    const summary = summarizeFields(record);
    return {
      title: `Azure ${type === 'log' ? 'log' : 'result'}: ${(message ?? summary ?? 'row').slice(0, 160)}`,
      summary: summary || 'KQL result row',
      rawContent: message ?? boundedJson(record),
      evidenceType: type,
      observedAt: toIso(record.TimeGenerated, params.timeWindow.end),
      severity: severityFromText(
        message ?? stringOf(record.SeverityLevel ?? record.Level, 40),
      ),
      tags: ['azure', 'kql'],
      sourceUri: `https://portal.azure.com/#@${encodeURIComponent(credential.tenantId)}/blade/Microsoft_Azure_Monitoring_Logs/LogsBlade/workspace/${credential.workspaceId}`,
      hashInput: record,
    };
  });
  return { records, truncated: rows.length > records.length };
}

export async function searchAzure(
  ctx: ProviderContext,
  params: ProviderSearchParams,
): Promise<ProviderResult> {
  const query = parseAzureQuery(params.query);
  const credential = parseAzureCredential(ctx.credential);
  return query.kind === 'metrics'
    ? searchMetrics(ctx, credential, query, params)
    : searchLogs(ctx, credential, query, params);
}
