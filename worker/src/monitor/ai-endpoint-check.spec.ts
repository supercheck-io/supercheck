import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import axios from 'axios';
import { executeAiEndpointCheck } from './ai-endpoint-check';
import type { MonitorConfig } from '../db/schema/types';

type Handler = (
  res: ServerResponse,
  req: { headers: Record<string, unknown>; body: Record<string, unknown> },
) => void;

const chunk = (content: string, extra: object = {}) =>
  `data: ${JSON.stringify({ model: 'gpt-x', system_fingerprint: 'fp1', choices: [{ delta: { content } }], ...extra })}\n\n`;
const usage = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, cost: 0.001 } })}\n\n`;
const okStream = (res: ServerResponse) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(chunk('O') + chunk('K') + usage + 'data: [DONE]\n\n');
};
const json = (status: number, body: object) => (res: ServerResponse) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const sse =
  (body: string, status = 200) =>
  (res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'text/event-stream' });
    res.end(body);
  };

describe('executeAiEndpointCheck', () => {
  let server: Server;
  let base: string;
  let handler: Handler;
  let hits: number;
  let seen: {
    headers: Record<string, unknown>;
    body: Record<string, unknown>;
  }[];
  const resolveSecret = jest.fn();
  const run = (
    ai: Partial<NonNullable<MonitorConfig['aiEndpoint']>> = {},
    extra: Partial<MonitorConfig> = {},
    path = '/v1/chat',
  ) =>
    executeAiEndpointCheck(
      `${base}${path}`,
      { aiEndpoint: { model: 'gpt-x', ...ai }, ...extra },
      {
        execute: (cfg) => axios.request(cfg),
        resolveSecret,
      },
    );

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits += 1;
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const entry = {
          headers: req.headers,
          body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
        };
        seen.push(entry);
        if (req.url === '/redirect') {
          res.writeHead(302, { location: '/v1/chat' });
          return res.end();
        }
        handler(res, entry);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  beforeEach(() => {
    process.env.ALLOW_INTERNAL_TARGETS = 'true';
    hits = 0;
    seen = [];
    handler = okStream;
    resolveSecret
      .mockReset()
      .mockResolvedValue({ ok: true, value: 'sk-secret-123' });
  });
  afterEach(() => delete process.env.ALLOW_INTERNAL_TARGETS);

  it('is up for a complete stream and records details.ai without the reply text', async () => {
    const r = await run({ secretKey: 'KEY', expectText: 'ok' });
    expect(r).toMatchObject({ status: 'up', isUp: true });
    expect(r.details.ai).toMatchObject({
      servedModel: 'gpt-x',
      systemFingerprint: 'fp1',
      promptTokens: 5,
      completionTokens: 2,
      totalTokens: 7,
      cost: 0.001,
    });
    expect(r.details.ai?.firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(r.responseTimeMs).toBe(r.details.ai?.totalMs);
    expect(JSON.stringify(r)).not.toContain('"OK"');
    expect(r.details.errorMessage).toBeUndefined();
    expect(seen[0].body).toEqual({
      model: 'gpt-x',
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      max_tokens: 16,
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(seen[0].headers.authorization).toBe('Bearer sk-secret-123');
  });

  it('sends the raw key in a custom header', async () => {
    await run({ secretKey: 'KEY', keyHeader: 'x-api-key' });
    expect(seen[0].headers['x-api-key']).toBe('sk-secret-123');
    expect(seen[0].headers.authorization).toBeUndefined();
  });

  it('sends no key when none is configured', async () => {
    await run();
    expect(resolveSecret).not.toHaveBeenCalled();
    expect(seen[0].headers.authorization).toBeUndefined();
  });

  it('scrubs a key echoed in model or system_fingerprint and bounds their length', async () => {
    resolveSecret.mockResolvedValue({ ok: true, value: 'sk-echoed-key' });
    handler = sse(
      `data: ${JSON.stringify({ model: 'm-sk-echoed-key', system_fingerprint: 'sk-echoed-key' + 'x'.repeat(500), choices: [{ delta: { content: 'OK' } }] })}\n\ndata: [DONE]\n\n`,
    );
    const r = await run({ secretKey: 'KEY' });
    expect(r.status).toBe('up');
    expect(JSON.stringify(r.details)).not.toContain('sk-echoed-key');
    expect(r.details.ai?.servedModel).toBe('m-***');
    expect((r.details.ai?.systemFingerprint ?? '').length).toBeLessThanOrEqual(
      200,
    );
  });

  it('leaves no key prefix when the key crosses the 200-character cap', async () => {
    resolveSecret.mockResolvedValue({ ok: true, value: 'sk-echoed-key' });
    handler = sse(
      `data: ${JSON.stringify({ model: 'm'.repeat(190) + 'sk-echoed-key', choices: [{ delta: { content: 'OK' } }] })}\n\ndata: [DONE]\n\n`,
    );
    const r = await run({ secretKey: 'KEY' });
    expect(r.details.ai?.servedModel).not.toContain('sk-echoed');
    expect(r.details.ai?.servedModel?.endsWith('***')).toBe(true);
  });

  it('errors with the resolver message when the key is missing', async () => {
    resolveSecret.mockResolvedValue({
      ok: false,
      message: 'Secret KEY was not found',
    });
    const r = await run({ secretKey: 'KEY' });
    expect(r).toMatchObject({ status: 'error', isUp: false });
    expect(r.details.errorMessage).toBe('Secret KEY was not found');
    expect(hits).toBe(0);
  });

  it.each([401, 403])('maps HTTP %i to key rejected', async (code) => {
    handler = json(code, { error: { message: 'no' } });
    expect(await run()).toMatchObject({
      status: 'down',
      details: { errorMessage: `Key rejected (${code})`, statusCode: code },
    });
  });

  it.each([
    [{ type: 'insufficient_quota' }],
    [{ code: 'insufficient_quota' }],
    [{ code: 'credit_balance_exhausted' }],
    [{ code: 'monthly_spend_limit_exceeded' }],
    [{ type: 'daily_usage_limit_exceeded' }],
  ])('maps billing 429 %j to out of credit', async (error) => {
    handler = json(429, { error });
    expect((await run()).details.errorMessage).toBe(
      'Out of credit or over the spend limit',
    );
  });

  it('maps any other 429 to rate limited, including an unparsable body', async () => {
    handler = json(429, { error: { type: 'rate_limit_exceeded' } });
    expect((await run()).details.errorMessage).toBe('Rate limited (429)');
    handler = (res) => {
      res.writeHead(429);
      res.end('slow down');
    };
    expect((await run()).details.errorMessage).toBe('Rate limited (429)');
  });

  it('maps other non-2xx to HTTP <code>', async () => {
    handler = json(500, {});
    expect(await run()).toMatchObject({
      status: 'down',
      details: { errorMessage: 'HTTP 500' },
    });
  });

  it('reports an error inside a 200 JSON body', async () => {
    handler = json(200, { error: { code: 'context_length', message: 'x' } });
    expect((await run()).details.errorMessage).toBe(
      'Error inside a 200 reply: context_length',
    );
  });

  it('reports an error chunk inside a stream, falling back to type', async () => {
    handler = sse(
      chunk('O') +
        `data: ${JSON.stringify({ error: { type: 'overloaded' } })}\n\ndata: [DONE]\n\n`,
    );
    expect((await run()).details.errorMessage).toBe(
      'Error inside a 200 reply: overloaded',
    );
  });

  it('reports finish_reason error', async () => {
    handler = sse(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'error' }] })}\n\ndata: [DONE]\n\n`,
    );
    expect((await run()).details.errorMessage).toBe(
      'Error inside a 200 reply: finish_reason_error',
    );
  });

  it('accepts a non-streamed JSON reply', async () => {
    handler = json(200, {
      model: 'm',
      choices: [{ message: { content: 'OK' } }],
    });
    expect(await run()).toMatchObject({ status: 'up' });
  });

  it('reports a cut-off stream (no [DONE])', async () => {
    handler = sse(chunk('OK'));
    expect((await run()).details.errorMessage).toBe('Reply was cut off');
  });

  it('reports a connection dropped mid-reply as cut off', async () => {
    handler = (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(chunk('O'));
      setTimeout(() => res.destroy(), 20);
    };
    expect((await run()).details.errorMessage).toBe('Reply was cut off');
  });

  it('reports an empty reply', async () => {
    handler = sse(usage + 'data: [DONE]\n\n');
    expect((await run()).details.errorMessage).toBe('Empty reply');
  });

  it('reports expected text missing', async () => {
    const r = await run({ expectText: 'banana' });
    expect(r).toMatchObject({
      status: 'down',
      details: { errorMessage: 'Reply did not contain the expected text' },
    });
  });

  it('times out when no first token arrives in time', async () => {
    handler = (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': keepalive\n\n');
      setTimeout(() => res.end(chunk('OK') + 'data: [DONE]\n\n'), 1500);
    };
    const r = await run({ firstTokenTimeoutMs: 150 });
    expect(r).toMatchObject({
      status: 'timeout',
      details: { errorMessage: 'No first token within 0.2 s' },
    });
  });

  it('times out on the total limit after the first token', async () => {
    handler = (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(chunk('O'));
    };
    const r = await run({}, { timeoutSeconds: 0.3 });
    expect(r).toMatchObject({
      status: 'timeout',
      details: { errorMessage: 'Timed out after 0.3 s' },
    });
  });

  it('times out when headers never arrive', async () => {
    handler = () => undefined;
    const r = await run({}, { timeoutSeconds: 0.2 });
    expect(r.status).toBe('timeout');
  });

  it('reports a missing first token when headers are held past the limit', async () => {
    handler = (res) => setTimeout(() => okStream(res), 400);
    const r = await run({ firstTokenTimeoutMs: 100 }, { timeoutSeconds: 5 });
    expect(r).toMatchObject({
      status: 'timeout',
      details: { errorMessage: 'No first token within 0.1 s' },
    });
    expect(r.responseTimeMs).toBeLessThan(1000);
  });

  it('fails a first token that arrives after the limit, even with the headers', async () => {
    handler = (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      setTimeout(() => res.end(chunk('OK') + 'data: [DONE]\n\n'), 300);
    };
    const r = await run({ firstTokenTimeoutMs: 100 }, { timeoutSeconds: 5 });
    expect(r.status).toBe('timeout');
  });

  it('reads a slow stream to the end without a false cut-off', async () => {
    handler = (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const parts = [chunk('O'), chunk('K'), usage, 'data: [DONE]\n\n'];
      parts.forEach((p, i) =>
        setTimeout(
          () => (i === parts.length - 1 ? res.end(p) : res.write(p)),
          60 * (i + 1),
        ),
      );
    };
    expect(await run()).toMatchObject({ status: 'up' });
  });

  it('does not follow a redirect and does not resend the key', async () => {
    const r = await run({ secretKey: 'KEY' }, {}, '/redirect');
    expect(r).toMatchObject({
      status: 'down',
      details: { errorMessage: 'Redirect not followed' },
    });
    expect(hits).toBe(1);
  });

  it('refuses a private target unless internal targets are allowed', async () => {
    delete process.env.ALLOW_INTERNAL_TARGETS;
    const r = await run();
    expect(r.status).toBe('error');
    expect(r.details.errorMessage).toContain('private or reserved');
    expect(hits).toBe(0);
  });

  it('never sends a secret over plain http unless internal targets are allowed', async () => {
    delete process.env.ALLOW_INTERNAL_TARGETS;
    const r = await run({ secretKey: 'KEY' });
    expect(r).toMatchObject({
      status: 'error',
      details: { errorMessage: 'A project secret is only sent over https' },
    });
    expect(resolveSecret).not.toHaveBeenCalled();
    expect(hits).toBe(0);
  });

  it('retries once with max_completion_tokens when max_tokens is rejected', async () => {
    handler = (res, req) => {
      if ('max_tokens' in req.body)
        return json(400, {
          error: {
            type: 'invalid_request_error',
            param: 'max_tokens',
            code: 'unsupported_parameter',
            message: "Use 'max_completion_tokens' instead.",
          },
        })(res);
      okStream(res);
    };
    const r = await run({ maxTokens: 64 });
    expect(r.status).toBe('up');
    expect(seen).toHaveLength(2);
    expect(seen[1].body).toMatchObject({ max_completion_tokens: 64 });
    expect(seen[1].body).not.toHaveProperty('max_tokens');
  });

  it('keeps the retry inside the one total time limit', async () => {
    handler = (res, req) => {
      if ('max_tokens' in req.body) {
        setTimeout(
          () =>
            json(400, {
              error: { param: 'max_tokens', code: 'unsupported_parameter' },
            })(res),
          600,
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(chunk('O'));
      setTimeout(() => res.end(chunk('K') + 'data: [DONE]\n\n'), 2000);
    };
    const r = await run({}, { timeoutSeconds: 1 });
    expect(r.status).toBe('timeout');
    expect(r.responseTimeMs).toBeGreaterThanOrEqual(900);
    expect(r.responseTimeMs).toBeLessThan(1500);
  });

  it('times the first token on streamed reasoning and explains a reply cut by the token limit', async () => {
    handler = sse(
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking' } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\ndata: [DONE]\n\n`,
    );
    const r = await run();
    expect(r.status).toBe('down');
    expect(r.details.errorMessage).toContain('Token limit reached');
    expect(Number.isInteger(r.details.ai?.firstTokenMs)).toBe(true);
  });

  it('names the provider error code and treats 402 as out of credit', async () => {
    handler = json(404, {
      error: { code: 'model_not_found', message: 'no such model sk-x' },
    });
    expect((await run()).details.errorMessage).toBe(
      'HTTP 404: model_not_found',
    );
    handler = json(402, { error: { message: 'Insufficient credits' } });
    expect((await run()).details.errorMessage).toBe(
      'Out of credit or over the spend limit',
    );
  });

  it('judges a 300 with a location as an HTTP status, not a cut-off reply', async () => {
    handler = (res) => {
      res.writeHead(300, { location: '/elsewhere' });
      res.end();
    };
    expect((await run()).details).toMatchObject({
      statusCode: 300,
      errorMessage: 'HTTP 300',
    });
  });

  it('redacts the secret from messages and caps their length', async () => {
    const r = await executeAiEndpointCheck(
      'http://127.0.0.1:1/x',
      { aiEndpoint: { model: 'm', secretKey: 'KEY' } },
      {
        execute: () =>
          Promise.reject(new Error(`${'x'.repeat(400)} sk-secret-123`)),
        resolveSecret,
      },
    );
    expect(r.status).toBe('down');
    expect(r.details.errorMessage).toHaveLength(300);
    const short = await executeAiEndpointCheck(
      `${base}/v1/chat`,
      { aiEndpoint: { model: 'm', secretKey: 'KEY' } },
      {
        execute: () => Promise.reject(new Error('bad sk-secret-123 here')),
        resolveSecret,
      },
    );
    expect(short.details.errorMessage).toBe('bad *** here');
  });

  it('classifies DNS failures as down', async () => {
    const r = await executeAiEndpointCheck(
      `${base}/x`,
      { aiEndpoint: { model: 'm' } },
      {
        execute: () =>
          Promise.reject(Object.assign(new Error('x'), { code: 'ENOTFOUND' })),
        resolveSecret,
      },
    );
    expect(r).toMatchObject({
      status: 'down',
      details: { errorMessage: 'DNS lookup failed' },
    });
  });
});
