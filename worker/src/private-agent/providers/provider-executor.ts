import * as crypto from 'node:crypto';
import { requestPrivateAgentEndpoint } from '../private-agent-endpoint';
import { searchAzure } from './azure-monitor';
import { searchGcp } from './gcp-monitoring';
import { searchJaeger } from './jaeger';
import { searchNewRelic } from './newrelic';
import {
  assertVendorUrl,
  PROVIDER_MAX_RESPONSE_BYTES,
  type ProviderContext,
  type ProviderCredential,
  type ProviderHttp,
  type ProviderResult,
  type ProviderSearchParams,
} from './provider-core';
import { searchSplunk } from './splunk';

export const OBSERVABILITY_PROVIDER_TYPES = [
  'jaeger',
  'newrelic',
  'splunk',
  'gcp_monitoring',
  'azure_monitor',
] as const;

export type ObservabilityProviderType =
  (typeof OBSERVABILITY_PROVIDER_TYPES)[number];

const SEARCHERS: Record<
  ObservabilityProviderType,
  (
    ctx: ProviderContext,
    params: ProviderSearchParams,
  ) => Promise<ProviderResult>
> = {
  jaeger: searchJaeger,
  newrelic: searchNewRelic,
  splunk: searchSplunk,
  gcp_monitoring: searchGcp,
  azure_monitor: searchAzure,
};

export type ObservabilityJobInput = {
  connectorId: string;
  connectorType: ObservabilityProviderType;
  endpointUrl: string | null;
  query: string;
  timeWindow: { start: string; end: string };
  budget: { maxRows: number; maxBytes: number; maxSeconds: number };
  credential: ProviderCredential | null;
};

async function readBoundedText(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) return { text: '', truncated: false };
  const decoder = new TextDecoder();
  let text = '';
  let received = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - received;
    if (value.byteLength > remaining) {
      text += decoder.decode(value.subarray(0, Math.max(remaining, 0)));
      truncated = true;
      await reader.cancel();
      break;
    }
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  return { text, truncated };
}

/**
 * Vendor targets (including OAuth token endpoints) must be on the fixed vendor
 * allowlist. Every request is DNS-pinned by requestPrivateAgentEndpoint, which
 * rejects loopback, link-local, multicast and metadata destinations.
 */
export const workerProviderHttp: ProviderHttp = async (request) => {
  if (request.target === 'vendor') assertVendorUrl(request.url);
  return requestPrivateAgentEndpoint(
    request.url,
    {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(request.timeoutMs),
      redirect: 'error',
    },
    async (response) => {
      const { text, truncated } = await readBoundedText(
        response,
        Math.min(request.maxBytes, PROVIDER_MAX_RESPONSE_BYTES),
      );
      return { status: response.status, text, truncated };
    },
  );
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

function hashPayload(payload: unknown) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(payload))
    .digest('hex');
}

export async function executeObservabilityProviderJob(
  input: ObservabilityJobInput,
  http: ProviderHttp = workerProviderHttp,
) {
  const maxRows = Math.min(input.budget.maxRows, 100);
  const result = await SEARCHERS[input.connectorType](
    {
      http,
      credential: input.credential ?? {},
      endpointUrl: input.endpointUrl,
    },
    {
      query: input.query,
      timeWindow: {
        start: new Date(input.timeWindow.start),
        end: new Date(input.timeWindow.end),
      },
      maxRows,
      maxBytes: input.budget.maxBytes,
      maxSeconds: input.budget.maxSeconds,
    },
  );

  const evidence = result.records.slice(0, maxRows).map((record) => ({
    id: `connector_${hashPayload({ connectorId: input.connectorId, sourceUri: record.sourceUri, title: record.title, hash: record.hashInput }).slice(0, 24)}`,
    sourceUri: record.sourceUri.slice(0, 1000),
    title: record.title.slice(0, 500),
    summary: [record.summary, record.rawContent]
      .filter(Boolean)
      .join('\n')
      .slice(0, 2000),
    evidenceType: record.evidenceType,
    observedAt: record.observedAt,
    resultHash: hashPayload(record.hashInput),
  }));
  const truncated = result.truncated || result.records.length > evidence.length;
  return {
    evidence,
    truncated,
    resultHash: hashPayload({ evidence, truncated }),
  };
}
