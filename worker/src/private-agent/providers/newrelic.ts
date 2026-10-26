// Shared with the Private Agent worker; see provider-core.ts.
import {
  asArray,
  boundedJson,
  clampInt,
  credentialText,
  isRecord,
  requestJson,
  rowLimit,
  severityFromText,
  stringOf,
  summarizeFields,
  PROVIDER_MAX_RESPONSE_BYTES,
  type ProviderContext,
  type ProviderEvidenceType,
  type ProviderRecord,
  type ProviderResult,
  type ProviderSearchParams,
} from './provider-core';

const PROVIDER = 'New Relic';
const ACCOUNT_ID_PATTERN = /^\d{1,12}$/;
const AGGREGATION_PATTERN =
  /\b(?:count|uniqueCount|average|sum|min|max|percentile|rate|median|stddev|latest|filter|histogram|apdex|funnel)\s*\(/i;
const STRIP_TIME_CLAUSE =
  /\b(?:since|until)\b\s+(?:'[^']*'|"[^"]*"|\d+\s+[a-z]+\s+ago|\d+|[a-z]+(?:\s+ago)?)/gi;

export function newRelicGraphqlUrl(credential: ProviderContext['credential']) {
  const region = credentialText(credential, ['region'])?.toLowerCase();
  return region === 'eu'
    ? 'https://api.eu.newrelic.com/graphql'
    : 'https://api.newrelic.com/graphql';
}

function nerdGraphAccess(ctx: ProviderContext) {
  const apiKey = credentialText(ctx.credential, ['apiKey', 'secret']);
  const accountId = credentialText(ctx.credential, ['accountId']);
  if (!apiKey)
    throw new Error('invalid credentials: New Relic requires a User API key');
  if (!accountId || !ACCOUNT_ID_PATTERN.test(accountId))
    throw new Error(
      'invalid credentials: New Relic requires a numeric account ID',
    );
  return { apiKey, accountId: Number(accountId) };
}

/** Read-only and window checks that do not depend on the time window itself. */
export function assertReadOnlyNrql(query: string) {
  const trimmed = query.trim();
  if (!trimmed) throw new Error('NRQL query is empty');
  if (!/^(?:select|from|show)\b/i.test(trimmed)) {
    throw new Error(
      'New Relic queries must be NRQL starting with SELECT, FROM or SHOW',
    );
  }
  if (trimmed.includes(';')) {
    throw new Error('NRQL queries must be a single statement without ";"');
  }
  if (/\bcompare\s+with\b/i.test(trimmed)) {
    throw new Error(
      'COMPARE WITH reads outside the investigation time window; run a second windowed query instead',
    );
  }
}

export function nrqlStatisticsError(query: string) {
  return AGGREGATION_PATTERN.test(query)
    ? null
    : 'New Relic statistics must use an NRQL aggregation such as count(*), average(duration) or percentile(duration, 95).';
}

function nrqlTimestamp(date: Date) {
  return `'${date.toISOString().replace(/\.\d{3}Z$/, '+0000')}'`;
}

export function prepareNrql(
  query: string,
  window: { start: Date; end: Date },
  limit: number,
) {
  assertReadOnlyNrql(query);
  const stripped = query
    .replace(STRIP_TIME_CLAUSE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasLimit = /\blimit\s+(?:\d+|max)\b/i.test(stripped);
  return [
    stripped,
    hasLimit ? null : `LIMIT ${limit}`,
    `SINCE ${nrqlTimestamp(window.start)} UNTIL ${nrqlTimestamp(window.end)}`,
  ]
    .filter(Boolean)
    .join(' ');
}

async function graphql(
  ctx: ProviderContext,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
) {
  const payload = await requestJson(ctx, PROVIDER, {
    url: newRelicGraphqlUrl(ctx.credential),
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'API-Key': apiKey,
    },
    body: JSON.stringify(body),
    timeoutMs,
    maxBytes: PROVIDER_MAX_RESPONSE_BYTES,
    target: 'vendor',
  });
  const errors = isRecord(payload) ? asArray(payload.errors) : [];
  if (errors.length) {
    const first = errors[0];
    const message = isRecord(first) ? stringOf(first.message, 240) : null;
    if (
      /not authorized|unauthor|forbidden|invalid api key/i.test(message ?? '')
    ) {
      throw new Error(
        'credentials rejected with HTTP 401: New Relic denied access. Check the User API key and account ID',
      );
    }
    throw new Error(
      `New Relic rejected the query: ${message ?? 'unknown error'}`,
    );
  }
  return payload;
}

export async function validateNewRelic(ctx: ProviderContext) {
  const { apiKey, accountId } = nerdGraphAccess(ctx);
  const payload = await graphql(
    ctx,
    apiKey,
    { query: `{ actor { account(id: ${accountId}) { name } } }` },
    10_000,
  );
  const account =
    isRecord(payload) &&
    isRecord(payload.data) &&
    isRecord(payload.data.actor) &&
    payload.data.actor.account;
  if (!isRecord(account)) {
    throw new Error(
      'invalid credentials: the User API key cannot read the configured New Relic account',
    );
  }
}

function recordType(nrql: string): ProviderEvidenceType {
  if (/\bfrom\s+log\b/i.test(nrql)) return 'log';
  if (/\bfrom\s+(?:span|distributedtracing)\b/i.test(nrql)) return 'trace';
  if (AGGREGATION_PATTERN.test(nrql) || /\b(?:facet|timeseries)\b/i.test(nrql))
    return 'metric';
  return 'event';
}

export async function searchNewRelic(
  ctx: ProviderContext,
  params: ProviderSearchParams,
): Promise<ProviderResult> {
  const { apiKey, accountId } = nerdGraphAccess(ctx);
  const limit = rowLimit(params);
  const nrql = prepareNrql(params.query, params.timeWindow, limit);
  const timeoutSeconds = clampInt(params.maxSeconds, 1, 30);
  const payload = await graphql(
    ctx,
    apiKey,
    {
      query: `query($nrql: Nrql!) { actor { account(id: ${accountId}) { nrql(query: $nrql, timeout: ${timeoutSeconds}) { results } } } }`,
      variables: { nrql },
    },
    timeoutSeconds * 1000,
  );
  const results =
    isRecord(payload) &&
    isRecord(payload.data) &&
    isRecord(payload.data.actor) &&
    isRecord(payload.data.actor.account) &&
    isRecord(payload.data.actor.account.nrql) &&
    Array.isArray(payload.data.actor.account.nrql.results)
      ? (payload.data.actor.account.nrql.results as unknown[])
      : [];

  const type = recordType(nrql);
  const host = newRelicGraphqlUrl(ctx.credential).includes('.eu.')
    ? 'one.eu.newrelic.com'
    : 'one.newrelic.com';
  const records = results
    .filter(isRecord)
    .slice(0, limit)
    .map((row): ProviderRecord => {
      const message = stringOf(row.message ?? row.error ?? row.name, 160);
      const timestamp =
        typeof row.timestamp === 'number'
          ? new Date(row.timestamp)
          : typeof row.beginTimeSeconds === 'number'
            ? new Date(row.beginTimeSeconds * 1000)
            : params.timeWindow.end;
      const summary = summarizeFields(row);
      return {
        title:
          `New Relic ${type === 'log' ? 'log' : 'result'}: ${message ?? (summary || 'row')}`.slice(
            0,
            200,
          ),
        summary: summary || 'NRQL result row',
        rawContent: boundedJson(row),
        evidenceType: type,
        observedAt: timestamp.toISOString(),
        severity: severityFromText(
          stringOf(row.level ?? row['log.level'] ?? row.message, 200),
        ),
        tags: ['newrelic', 'nrql', `account:${accountId}`],
        sourceUri: `https://${host}/nrql?account=${accountId}&query=${encodeURIComponent(nrql.slice(0, 200))}`,
        hashInput: row,
      };
    });
  return { records, truncated: results.length > records.length };
}
