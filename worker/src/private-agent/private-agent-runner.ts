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
  connectorType: z.enum(['github', 'prometheus', 'grafana', 'kubernetes']),
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

function secretFromCredential(job: LeasedJob) {
  const secret = job.credential?.value?.secret;
  return typeof secret === 'string' && secret.trim() ? secret.trim() : null;
}

function normalizedEndpoint(spec: ConnectorJobSpec) {
  if (spec.connectorType === 'github') {
    return (spec.endpointUrl ?? 'https://api.github.com').replace(/\/$/, '');
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
