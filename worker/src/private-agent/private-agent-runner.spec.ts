import {
  exchangeRegistrationToken,
  executePrivateAgentConnectorJob,
  type PrivateAgentConfig,
} from './private-agent-runner';

const baseJob = {
  id: '018f0000-0000-7000-8000-000000000001',
  jobClass: 'sre_connector_query' as const,
  connectorId: '018f0000-0000-7000-8000-000000000002',
  projectId: '018f0000-0000-7000-8000-000000000003',
  jobSpecHash: 'a'.repeat(64),
  leaseExpiresAt: '2026-06-22T10:00:00.000Z',
  credential: { credentialType: 'bearer_token', value: { secret: 'token' } },
  jobSpec: {
    jobClass: 'sre_connector_query' as const,
    connectorId: '018f0000-0000-7000-8000-000000000002',
    connectorType: 'prometheus' as const,
    endpointUrl: 'https://prometheus.internal',
    serviceId: 'service_1',
    query: 'up',
    timeWindow: {
      start: '2026-06-22T09:00:00.000Z',
      end: '2026-06-22T10:00:00.000Z',
    },
    budget: { maxRows: 5, maxBytes: 10_000, maxSeconds: 5, maxCost: 0 },
    filters: {},
  },
};

describe('private agent connector execution', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('executes Prometheus jobs and returns bounded evidence summaries', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          result: [
            {
              metric: { __name__: 'up', job: 'checkout' },
              values: [[1782120000, '1']],
            },
          ],
        },
      }),
    }) as unknown as typeof fetch;

    const result = await executePrivateAgentConnectorJob(baseJob);

    expect(result).toMatchObject({ truncated: false });
    expect(result.resultHash).toHaveLength(64);
    expect(result.evidence[0]).toMatchObject({
      title: 'Prometheus metric: up',
      evidenceType: 'metric',
      sourceUri: 'https://prometheus.internal/graph?g0.expr=up',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/query_range'),
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
  });

  it('executes Kubernetes jobs without persisting raw pod payloads', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            metadata: { name: 'checkout-7d9c', namespace: 'payments' },
            status: {
              phase: 'Running',
              startTime: '2026-06-22T09:30:00.000Z',
              containerStatuses: [
                { name: 'app', ready: false, restartCount: 2 },
              ],
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const result = await executePrivateAgentConnectorJob({
      ...baseJob,
      jobSpec: {
        ...baseJob.jobSpec,
        connectorType: 'kubernetes',
        endpointUrl: 'https://kubernetes.default.svc',
        query: 'app=checkout',
        filters: { namespace: 'payments' },
      },
    });

    expect(result.evidence[0]).toMatchObject({
      title: 'Kubernetes pod: payments/checkout-7d9c',
      evidenceType: 'topology',
      summary: 'Phase Running - 2 restart(s) - Not ready: app',
    });
    expect(JSON.stringify(result.evidence)).not.toContain('containerStatuses');
  });

  it('blocks localhost connector endpoints in private-agent mode', async () => {
    await expect(
      executePrivateAgentConnectorJob({
        ...baseJob,
        jobSpec: { ...baseJob.jobSpec, endpointUrl: 'http://localhost:9090' },
      }),
    ).rejects.toThrow('cannot target localhost');
  });

  it('exchanges registration tokens for runtime credentials', async () => {
    const config: PrivateAgentConfig = {
      apiUrl: 'https://app.supercheck.io',
      agentId: '018f0000-0000-7000-8000-000000000001',
      token: 'scpa_registration',
      tokenSource: 'env',
      credentialFile: null,
      agentVersion: '1.3.5',
      retryIntervalMs: 5_000,
      leaseWaitMs: 25_000,
      heartbeatIntervalMs: 30_000,
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        token: 'scpac_runtime_1234567890',
        keyId: 'pa_123',
        agent: {
          id: config.agentId,
          status: 'connected',
          registeredAt: '2026-06-22T10:00:00.000Z',
        },
      }),
    }) as unknown as typeof fetch;

    const exchanged = await exchangeRegistrationToken(config);

    expect(exchanged.token).toBe('scpac_runtime_1234567890');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://app.supercheck.io/api/private-agents/registration/exchange',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer scpa_registration',
        }),
      }),
    );
  });

  it('keeps existing bearer tokens when registration exchange returns unauthorized', async () => {
    const config: PrivateAgentConfig = {
      apiUrl: 'https://app.supercheck.io',
      agentId: '018f0000-0000-7000-8000-000000000001',
      token: 'scpa_existing_runtime',
      tokenSource: 'env',
      credentialFile: null,
      agentVersion: '1.3.5',
      retryIntervalMs: 5_000,
      leaseWaitMs: 25_000,
      heartbeatIntervalMs: 30_000,
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    }) as unknown as typeof fetch;

    await expect(exchangeRegistrationToken(config)).resolves.toBe(config);
  });
});
