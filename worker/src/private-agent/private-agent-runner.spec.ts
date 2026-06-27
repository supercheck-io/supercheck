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

  it('executes Sentry jobs and returns issue summaries', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: '123',
          shortId: 'API-1',
          title: 'Checkout regression',
          culprit: 'checkout.api',
          permalink: 'https://sentry.example.com/issues/123',
          level: 'error',
          status: 'unresolved',
          count: 42,
          lastSeen: '2026-06-22T09:55:00.000Z',
          entries: [{ data: { values: ['raw stack omitted from summary'] } }],
        },
      ],
    }) as unknown as typeof fetch;

    const result = await executePrivateAgentConnectorJob({
      ...baseJob,
      jobSpec: {
        ...baseJob.jobSpec,
        connectorType: 'sentry',
        endpointUrl: 'https://sentry.example.com/api/0/projects/acme/api',
        query: 'is:unresolved',
      },
    });

    expect(result.evidence[0]).toMatchObject({
      title: 'Sentry issue: Checkout regression',
      evidenceType: 'event',
      observedAt: '2026-06-22T09:55:00.000Z',
    });
    expect(JSON.stringify(result.evidence)).not.toContain('raw stack');
  });

  it('executes Datadog jobs with API and application key headers', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        events: [
          {
            id: 99,
            title: 'High latency',
            text: 'p95 latency breach',
            date_happened: 1782122100,
            alert_type: 'error',
            source: 'monitor',
            host: 'checkout-1',
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const result = await executePrivateAgentConnectorJob({
      ...baseJob,
      credential: {
        credentialType: 'api_key',
        value: { apiKey: 'dd_api', applicationKey: 'dd_app' },
      },
      jobSpec: {
        ...baseJob.jobSpec,
        connectorType: 'datadog',
        endpointUrl: 'https://api.datadoghq.com',
        query: 'service:checkout',
      },
    });

    expect(result.evidence[0]).toMatchObject({
      title: 'Datadog event: High latency',
      evidenceType: 'event',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/events'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'DD-API-KEY': 'dd_api',
          'DD-APPLICATION-KEY': 'dd_app',
        }),
      }),
    );
  });

  it('executes Loki jobs and flattens log streams into bounded evidence', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          result: [
            {
              stream: { service: 'checkout', level: 'error' },
              values: [['1782122100000000000', 'error checkout timeout']],
            },
          ],
        },
      }),
    }) as unknown as typeof fetch;

    const result = await executePrivateAgentConnectorJob({
      ...baseJob,
      jobSpec: {
        ...baseJob.jobSpec,
        connectorType: 'loki',
        endpointUrl: 'https://loki.internal',
        query: '{service="checkout"} |= "error"',
      },
    });

    expect(result.evidence[0]).toMatchObject({
      title: 'Loki log: error checkout timeout',
      evidenceType: 'log',
      summary: 'service=checkout, level=error - error',
    });
  });

  it('executes Elasticsearch jobs without returning raw documents', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        hits: {
          hits: [
            {
              _id: 'doc-1',
              _index: 'logs-checkout',
              _score: 12.5,
              _source: {
                '@timestamp': '2026-06-22T09:58:00.000Z',
                message: 'error processing payment',
                service: { name: 'checkout' },
                log: { level: 'error' },
                stacktrace: 'sensitive raw stack omitted',
              },
            },
          ],
        },
      }),
    }) as unknown as typeof fetch;

    const result = await executePrivateAgentConnectorJob({
      ...baseJob,
      jobSpec: {
        ...baseJob.jobSpec,
        connectorType: 'elasticsearch',
        endpointUrl: 'https://elasticsearch.internal',
        query: 'error',
        filters: { index: 'logs-checkout' },
      },
    });

    expect(result.evidence[0]).toMatchObject({
      title: 'Elasticsearch log: error processing payment',
      evidenceType: 'log',
      observedAt: '2026-06-22T09:58:00.000Z',
    });
    expect(JSON.stringify(result.evidence)).not.toContain('sensitive raw stack');
  });

  it('executes Tempo jobs and preserves trace evidence shape', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        traces: [
          {
            traceID: 'trace-1',
            rootServiceName: 'checkout',
            rootTraceName: 'POST /checkout',
            startTimeUnixNano: '1782122100000000000',
            durationMs: 1450,
            serviceStats: { checkout: {}, payments: {} },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const result = await executePrivateAgentConnectorJob({
      ...baseJob,
      jobSpec: {
        ...baseJob.jobSpec,
        connectorType: 'tempo',
        endpointUrl: 'https://tempo.internal',
        query: 'service:checkout minDuration:1s',
      },
    });

    expect(result.evidence[0]).toMatchObject({
      title: 'Tempo trace: checkout POST /checkout',
      evidenceType: 'trace',
      summary: expect.stringContaining('duration 1.45s'),
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/search'),
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('executes CloudWatch alarm jobs with signed read-only Query API calls', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `
        <DescribeAlarmsResponse>
          <DescribeAlarmsResult>
            <MetricAlarms>
              <member>
                <AlarmName>checkout-latency</AlarmName>
                <AlarmArn>arn:aws:cloudwatch:us-east-1:123:alarm:checkout-latency</AlarmArn>
                <StateValue>ALARM</StateValue>
                <StateUpdatedTimestamp>2026-06-22T09:59:00.000Z</StateUpdatedTimestamp>
                <Namespace>AWS/ApplicationELB</Namespace>
                <MetricName>TargetResponseTime</MetricName>
                <StateReason>threshold breached</StateReason>
              </member>
            </MetricAlarms>
          </DescribeAlarmsResult>
        </DescribeAlarmsResponse>`,
    }) as unknown as typeof fetch;

    const result = await executePrivateAgentConnectorJob({
      ...baseJob,
      credential: {
        credentialType: 'api_key',
        value: {
          apiKey: 'AKIA_TEST',
          secret: 'cloudwatch_secret',
          sessionToken: 'sts_token',
          region: 'us-east-1',
        },
      },
      jobSpec: {
        ...baseJob.jobSpec,
        connectorType: 'aws_cloudwatch',
        endpointUrl: 'https://monitoring.us-east-1.amazonaws.com',
        query: 'prefix:checkout state:ALARM',
      },
    });

    expect(result.evidence[0]).toMatchObject({
      title: 'CloudWatch alarm: checkout-latency',
      evidenceType: 'metric',
      summary: expect.stringContaining('ALARM'),
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://monitoring.us-east-1.amazonaws.com',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('AWS4-HMAC-SHA256'),
          'X-Amz-Security-Token': 'sts_token',
        }),
        body: expect.stringContaining('Action=DescribeAlarms'),
      }),
    );
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
