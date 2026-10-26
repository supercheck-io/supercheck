import {
  executeObservabilityProviderJob,
  workerProviderHttp,
} from './provider-executor';
import type { ProviderHttp } from './provider-core';

const baseJob = {
  connectorId: 'c1',
  endpointUrl: 'https://splunk.internal.example.com:8089',
  query: 'index=main error',
  timeWindow: {
    start: '2026-10-27T11:00:00.000Z',
    end: '2026-10-27T12:00:00.000Z',
  },
  budget: { maxRows: 2, maxBytes: 100_000, maxSeconds: 5 },
  credential: { secret: 'tok' },
};

describe('private agent observability providers', () => {
  it('runs a Splunk search through the injected transport and shapes evidence', async () => {
    const lines = [1, 2, 3]
      .map((n) =>
        JSON.stringify({
          result: {
            _raw: `ERROR boom ${n}`,
            _time: '2026-10-27T11:30:00Z',
            index: 'main',
          },
        }),
      )
      .join('\n');
    const http: ProviderHttp = jest.fn(async () => ({
      status: 200,
      text: lines,
      truncated: false,
    }));
    const result = await executeObservabilityProviderJob(
      { ...baseJob, connectorType: 'splunk' },
      http,
    );
    expect(result.evidence).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.evidence[0]).toMatchObject({
      evidenceType: 'log',
      observedAt: '2026-10-27T11:30:00.000Z',
    });
    expect(result.evidence[0].id).toMatch(/^connector_[a-f0-9]{24}$/);
    expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/);
    const call = (http as jest.Mock).mock.calls[0][0];
    expect(call.headers.Authorization).toBe('Bearer tok');
    expect(call.target).toBe('endpoint');
  });

  it('rejects write commands before calling the transport', async () => {
    const http = jest.fn();
    await expect(
      executeObservabilityProviderJob(
        { ...baseJob, connectorType: 'splunk', query: 'index=a | delete' },
        http,
      ),
    ).rejects.toThrow(/not allowed/);
    expect(http).not.toHaveBeenCalled();
  });

  it('runs a Jaeger search and New Relic validation errors map to messages', async () => {
    const http: ProviderHttp = async () => ({
      status: 200,
      text: JSON.stringify({ data: ['a'] }),
      truncated: false,
    });
    const jaeger = await executeObservabilityProviderJob(
      {
        ...baseJob,
        connectorType: 'jaeger',
        endpointUrl: 'https://jaeger.internal.example.com',
        query: '*',
        credential: null,
      },
      http,
    );
    expect(jaeger.evidence[0].evidenceType).toBe('topology');
    await expect(
      executeObservabilityProviderJob(
        {
          ...baseJob,
          connectorType: 'newrelic',
          endpointUrl: null,
          query: 'SELECT 1 FROM Log',
          credential: { apiKey: 'k' },
        },
        http,
      ),
    ).rejects.toThrow(/account ID/);
  });

  it('refuses vendor-target requests to hosts outside the allowlist before any DNS lookup', async () => {
    await expect(
      workerProviderHttp({
        url: 'https://evil.example.com/token',
        method: 'POST',
        headers: {},
        timeoutMs: 1000,
        maxBytes: 1000,
        target: 'vendor',
      }),
    ).rejects.toThrow(/not allowed/);
  });

  it('refuses loopback and metadata customer endpoints', async () => {
    for (const url of [
      'http://127.0.0.1:8089/x',
      'http://169.254.169.254/latest',
      'http://localhost/x',
    ]) {
      await expect(
        workerProviderHttp({
          url,
          method: 'GET',
          headers: {},
          timeoutMs: 1000,
          maxBytes: 1000,
          target: 'endpoint',
        }),
      ).rejects.toThrow(/cannot target localhost or cloud metadata/);
    }
  });
});
