// Shared with the Private Agent worker; see provider-core.ts.
import {
  asArray,
  boundedJson,
  clampInt,
  isRecord,
  providerHttpError,
  requireEndpoint,
  requestJson,
  rowLimit,
  severityFromText,
  stringOf,
  summarizeFields,
  toIso,
  PROVIDER_MAX_RESPONSE_BYTES,
  bearerHeaders,
  type ProviderContext,
  type ProviderRecord,
  type ProviderResult,
  type ProviderSearchParams,
} from './provider-core';

const PROVIDER = 'Splunk';

// Commands that write, notify, run code or reach outside the search index.
const BLOCKED_COMMANDS = [
  'delete',
  'outputlookup',
  'outputcsv',
  'outputtext',
  'collect',
  'summaryindex',
  'mcollect',
  'meventcollect',
  'tscollect',
  'sendemail',
  'sendalert',
  'script',
  'run',
  'runshellscript',
  'dump',
  'rest',
  'dbxquery',
  'curl',
  'webhook',
  'savedsearch',
  'map',
  'loadjob',
  'inputcsv',
  'fit',
  'deletemodel',
  'outputrss',
  'external',
  'externalsearch',
];
// Only commands after a pipe can run; "[ | delete ]" subsearches are covered
// because the pipe is still present.
const BLOCKED_COMMAND_PATTERN = new RegExp(
  `\\|\\s*(?:${BLOCKED_COMMANDS.join('|')})\\b|\\bfrom\\s+savedsearch\\s*:`,
  'i',
);
const STATS_PATTERN =
  /(?:^|\|)\s*(?:stats|timechart|chart|top|rare|tstats|eventstats|streamstats)\b/i;

export function assertReadOnlySpl(query: string) {
  const trimmed = query.trim();
  if (!trimmed) throw new Error('Splunk search is empty');
  if (trimmed.includes('`')) {
    throw new Error('Splunk searches cannot use macros or backtick comments');
  }
  const blocked = BLOCKED_COMMAND_PATTERN.exec(trimmed);
  if (blocked) {
    const command = blocked[0].replace(/^\|\s*/, '').toLowerCase();
    throw new Error(
      `Splunk command "${command}" is not allowed: connectors are read-only and cannot write, notify, run scripts or fan out searches`,
    );
  }
}

export function splStatisticsError(query: string) {
  return STATS_PATTERN.test(query)
    ? null
    : 'Splunk statistics must aggregate with stats, timechart, chart or top, for example "... | stats count by sourcetype".';
}

// earliest/latest inside the search would widen the window set on the job.
const STRIP_TIME_MODIFIER =
  /\b(?:earliest|latest)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s)\]|]+)/gi;

export function prepareSpl(query: string) {
  assertReadOnlySpl(query);
  const stripped = query
    .replace(STRIP_TIME_MODIFIER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:search\b|\|)/i.test(stripped) ? stripped : `search ${stripped}`;
}

function exportUrl(ctx: ProviderContext) {
  return `${requireEndpoint(ctx, PROVIDER)}/services/search/jobs/export`;
}

export async function validateSplunk(ctx: ProviderContext) {
  const endpoint = requireEndpoint(ctx, PROVIDER);
  if (!bearerHeaders(ctx.credential).Authorization) {
    throw new Error(
      'invalid credentials: Splunk requires an authentication token',
    );
  }
  await requestJson(ctx, PROVIDER, {
    url: `${endpoint}/services/authentication/current-context?output_mode=json`,
    method: 'GET',
    headers: bearerHeaders(ctx.credential),
    timeoutMs: 10_000,
    maxBytes: PROVIDER_MAX_RESPONSE_BYTES,
    target: 'endpoint',
  });
}

export async function searchSplunk(
  ctx: ProviderContext,
  params: ProviderSearchParams,
): Promise<ProviderResult> {
  if (!bearerHeaders(ctx.credential).Authorization) {
    throw new Error(
      'invalid credentials: Splunk requires an authentication token',
    );
  }
  const search = prepareSpl(params.query);
  const limit = rowLimit(params);
  const body = new URLSearchParams({
    search,
    earliest_time: String(Math.floor(params.timeWindow.start.getTime() / 1000)),
    latest_time: String(Math.ceil(params.timeWindow.end.getTime() / 1000)),
    output_mode: 'json',
    count: String(limit + 1),
    max_time: String(clampInt(params.maxSeconds - 1, 1, 60)),
  }).toString();

  const response = await postExport(ctx, body, params);
  if (response.status < 200 || response.status >= 300) {
    throw providerHttpError(PROVIDER, response.status, response.text);
  }

  const rows: Record<string, unknown>[] = [];
  const lines = response.text.split('\n');
  // A body cut at the byte budget ends mid-line; never parse the partial tail.
  if (response.truncated) lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    if (Array.isArray(parsed.messages)) {
      const fatal = asArray(parsed.messages).find(
        (message) =>
          isRecord(message) &&
          (message.type === 'FATAL' || message.type === 'ERROR'),
      );
      if (isRecord(fatal)) {
        throw new Error(
          `Splunk rejected the search: ${stringOf(fatal.text, 240) ?? 'unknown error'}`,
        );
      }
    }
    if (isRecord(parsed.result) && parsed.preview !== true) {
      rows.push(parsed.result);
    }
  }

  const endpoint = requireEndpoint(ctx, PROVIDER);
  const records = rows.slice(0, limit).map((row): ProviderRecord => {
    const raw = stringOf(row._raw, 4000);
    const title = (raw ?? summarizeFields(row, 6, 60)) || 'Splunk result';
    return {
      title: `Splunk ${raw ? 'log' : 'result'}: ${title.slice(0, 160)}`,
      summary: raw
        ? [row.index, row.source, row.sourcetype, row.host]
            .map((value) => stringOf(value, 80))
            .filter(Boolean)
            .join(' · ') || 'Splunk event'
        : summarizeFields(row),
      rawContent: raw ?? boundedJson(row),
      evidenceType: raw ? 'log' : 'metric',
      observedAt: toIso(row._time, params.timeWindow.end),
      severity: severityFromText(raw),
      tags: [
        'splunk',
        ...['index', 'sourcetype', 'host']
          .map((key) => {
            const value = stringOf(row[key], 80);
            return value ? `${key}:${value}` : null;
          })
          .filter((tag): tag is string => Boolean(tag)),
      ],
      sourceUri: `${endpoint}/services/search/jobs/export?search=${encodeURIComponent(search.slice(0, 200))}`,
      hashInput: row,
    };
  });
  return {
    records,
    truncated: rows.length > records.length || response.truncated,
  };
}

function postExport(
  ctx: ProviderContext,
  body: string,
  params: ProviderSearchParams,
) {
  return ctx.http({
    url: exportUrl(ctx),
    method: 'POST',
    headers: bearerHeaders(ctx.credential, {
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body,
    timeoutMs: params.maxSeconds * 1000,
    // Streaming export: stop reading at the byte budget and keep the lines received.
    maxBytes: Math.min(
      Math.max(params.maxBytes * 2, 64 * 1024),
      PROVIDER_MAX_RESPONSE_BYTES,
    ),
    target: 'endpoint',
  });
}
