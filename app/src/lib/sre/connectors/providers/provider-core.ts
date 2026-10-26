// Shared by the app connectors and the Private Agent worker. The worker keeps a
// byte-identical copy under worker/src/private-agent/providers/; a spec in the
// app fails when the two drift. Keep this file free of app-only imports.
import { createHash } from 'node:crypto';

export type ProviderCredential = Record<
  string,
  string | number | boolean | null | undefined
>;

export type ProviderEvidenceType =
  'metric' | 'log' | 'trace' | 'event' | 'topology';

export type ProviderRecord = {
  title: string;
  summary: string;
  rawContent?: string;
  evidenceType: ProviderEvidenceType;
  observedAt: string;
  severity?: string;
  tags: string[];
  sourceUri: string;
  hashInput: unknown;
};

export type ProviderSearchParams = {
  query: string;
  timeWindow: { start: Date; end: Date };
  maxRows: number;
  maxBytes: number;
  maxSeconds: number;
};

export type ProviderResult = { records: ProviderRecord[]; truncated: boolean };

export type ProviderHttpRequest = {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  // "endpoint" targets the customer-configured URL. "vendor" targets a fixed
  // provider host (including OAuth token endpoints) and is checked against
  // PROVIDER_VENDOR_HOSTS by the transport before any connection is made.
  target: 'endpoint' | 'vendor';
};

export type ProviderHttpResponse = {
  status: number;
  text: string;
  truncated: boolean;
};

export type ProviderHttp = (
  request: ProviderHttpRequest,
) => Promise<ProviderHttpResponse>;

export type ProviderContext = {
  http: ProviderHttp;
  credential: ProviderCredential;
  endpointUrl: string | null;
  now?: () => number;
};

export const PROVIDER_VENDOR_HOSTS: ReadonlySet<string> = new Set([
  'api.newrelic.com',
  'api.eu.newrelic.com',
  'oauth2.googleapis.com',
  'monitoring.googleapis.com',
  'logging.googleapis.com',
  'login.microsoftonline.com',
  'management.azure.com',
  'api.loganalytics.azure.com',
]);

export const PROVIDER_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const PROVIDER_MAX_ROWS = 100;

export function assertVendorUrl(input: string): URL {
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    !PROVIDER_VENDOR_HOSTS.has(url.hostname.toLowerCase())
  ) {
    throw new Error('Provider request targets a host that is not allowed');
  }
  return url;
}

export function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

export function rowLimit(params: ProviderSearchParams) {
  return clampInt(params.maxRows, 1, PROVIDER_MAX_ROWS);
}

/** Replaces control characters (except tab, LF, CR) with spaces. */
export function stripControlChars(text: string) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const control =
      code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    out += control ? ' ' : text[i];
  }
  return out;
}

export function hasControlChars(text: string) {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) <= 0x1f) return true;
  }
  return false;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

export function stringOf(value: unknown, max = 300): string | null {
  let text: string | null = null;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean')
    text = String(value);
  if (text === null) return null;
  const trimmed = stripControlChars(text).trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 3)}...` : trimmed;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function severityFromText(value: string | null | undefined) {
  if (!value) return undefined;
  const lowered = value.toLowerCase();
  if (
    lowered.includes('fatal') ||
    lowered.includes('panic') ||
    lowered.includes('critical') ||
    lowered.includes('emergency')
  )
    return 'critical';
  if (lowered.includes('error') || lowered.includes('exception'))
    return 'error';
  if (lowered.includes('warn')) return 'warning';
  if (lowered.includes('info') || lowered.includes('notice')) return 'info';
  return undefined;
}

export function toIso(value: unknown, fallback: Date): string {
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback.toISOString();
}

/** Bounded, single-line summary of an object's scalar fields. */
export function summarizeFields(
  row: Record<string, unknown>,
  maxFields = 10,
  maxValue = 80,
) {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (parts.length >= maxFields) break;
    const text = stringOf(value, maxValue);
    if (text) parts.push(`${key}=${text.replace(/\s+/g, ' ')}`);
  }
  return parts.join(', ');
}

export function boundedJson(value: unknown, max = 2000) {
  const json = JSON.stringify(value);
  if (json === undefined) return undefined;
  return json.length > max ? `${json.slice(0, max)}...` : json;
}

/**
 * Parses `key:value` / `key=value` tokens. Values may be double quoted.
 * Returns the tokens plus any leftover text.
 */
export function parseKeyValueTokens(query: string, separators = ':=') {
  const values: Record<string, string> = {};
  const pattern = new RegExp(
    `([A-Za-z_][A-Za-z0-9_.-]*)[${separators}]("(?:[^"\\\\]|\\\\.)*"|\\S+)`,
    'g',
  );
  const rest = query.replace(pattern, (_match, key: string, raw: string) => {
    values[key] =
      raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2
        ? raw.slice(1, -1).replace(/\\(.)/g, '$1')
        : raw;
    return ' ';
  });
  return { values, rest: rest.replace(/\s+/g, ' ').trim() };
}

export function providerHttpError(
  provider: string,
  status: number,
  body: string,
  // Only fixed vendor hosts may echo a response body; customer endpoints could be hostile.
  includeDetail = false,
) {
  if (status === 401 || status === 403) {
    return new Error(
      `credentials rejected with HTTP ${status}: ${provider} denied access. Check the credential and its read-only permissions`,
    );
  }
  if (status === 429) {
    return new Error(`${provider} rate limit reached (HTTP 429)`);
  }
  if (status >= 400 && status < 500) {
    const detail = includeDetail ? stringOf(body, 200) : null;
    return new Error(
      `${provider} rejected the request with HTTP ${status}${detail ? `: ${detail}` : ''}`,
    );
  }
  return new Error(`${provider} request failed with HTTP ${status}`);
}

export function parseProviderJson(
  provider: string,
  response: ProviderHttpResponse,
) {
  if (response.truncated) {
    throw new Error(
      `${provider} response exceeded the size budget; narrow the query or time window`,
    );
  }
  try {
    return JSON.parse(response.text) as unknown;
  } catch {
    throw new Error(`${provider} returned a response that is not valid JSON`);
  }
}

export async function requestJson(
  ctx: ProviderContext,
  provider: string,
  request: ProviderHttpRequest,
) {
  const response = await ctx.http(request);
  if (response.status < 200 || response.status >= 300) {
    throw providerHttpError(
      provider,
      response.status,
      response.text,
      request.target === 'vendor',
    );
  }
  return parseProviderJson(provider, response);
}

export function requireEndpoint(ctx: ProviderContext, provider: string) {
  if (!ctx.endpointUrl) throw new Error(`${provider} endpoint URL is required`);
  return ctx.endpointUrl.replace(/\/+$/, '');
}

export function credentialText(
  credential: ProviderCredential,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = credential[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

export function bearerHeaders(
  credential: ProviderCredential,
  extra: Record<string, string> = {},
): Record<string, string> {
  const secret = credentialText(credential, ['secret', 'apiKey']);
  return {
    Accept: 'application/json',
    ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    ...extra,
  };
}

type CachedToken = { token: string; expiresAtMs: number };
const tokenCache = new Map<string, CachedToken>();
const MAX_CACHED_TOKENS = 50;

export function readCachedToken(key: string, nowMs: number) {
  const cached = tokenCache.get(key);
  if (!cached) return null;
  if (cached.expiresAtMs - 60_000 <= nowMs) {
    tokenCache.delete(key);
    return null;
  }
  return cached.token;
}

export function writeCachedToken(
  key: string,
  token: string,
  expiresInSeconds: number,
  nowMs: number,
) {
  if (tokenCache.size >= MAX_CACHED_TOKENS) {
    const oldest = tokenCache.keys().next().value as string | undefined;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  tokenCache.set(key, {
    token,
    expiresAtMs: nowMs + clampInt(expiresInSeconds, 60, 3600) * 1000,
  });
}

export function clearProviderTokenCache() {
  tokenCache.clear();
}

export function nowMs(ctx: ProviderContext) {
  return ctx.now ? ctx.now() : Date.now();
}

/** Reads an OAuth token response and returns the access token. */
export function readAccessToken(
  provider: string,
  response: ProviderHttpResponse,
): { token: string; expiresIn: number } {
  if (response.status === 400 || response.status === 401) {
    let detail = '';
    try {
      const parsed = JSON.parse(response.text) as Record<string, unknown>;
      detail = stringOf(parsed.error_description ?? parsed.error, 160) ?? '';
    } catch {
      // Non-JSON error bodies carry nothing safe to show.
    }
    throw new Error(
      `invalid credentials: ${provider} rejected the sign-in${detail ? ` (${detail.split('\n')[0]})` : ''}`,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw providerHttpError(provider, response.status, response.text);
  }
  const parsed = parseProviderJson(provider, response);
  const token = isRecord(parsed) ? stringOf(parsed.access_token, 8192) : null;
  if (!token) throw new Error(`${provider} sign-in returned no access token`);
  const expires =
    isRecord(parsed) && typeof parsed.expires_in === 'number'
      ? parsed.expires_in
      : 3600;
  return { token, expiresIn: expires };
}
