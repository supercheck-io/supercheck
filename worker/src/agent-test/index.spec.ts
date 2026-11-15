import { mkdtemp, readFile, rm } from 'fs/promises';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

// extend() returns its fixtures, so the agent fixture can be driven without a Playwright run.
jest.mock('@playwright/test', () => ({
  test: { extend: (fixtures: unknown) => fixtures },
  expect: () => undefined,
}));

import { buildSummary, redactedJson, test as fixtures } from './index';
import { newState } from './agent';
import { secretsOf } from './clients';

const fixture = (
  fixtures as unknown as {
    agent: (
      deps: object,
      use: (agent: any) => Promise<void>,
      info: object,
    ) => Promise<void>;
  }
).agent;

describe('buildSummary', () => {
  const base = {
    judgeTokens: 3,
    secrets: [],
    repeats: [
      {
        attempts: 10,
        passed: 7,
        failed: 3,
        passRate: 0.7,
        failures: Array.from({ length: 8 }, (_, i) => ({
          attempt: i + 1,
          message: 'm'.repeat(300),
        })),
      },
    ],
    sends: Array.from({ length: 30 }, (_, i) => ({
      attempt: i + 1,
      prompt: 'p'.repeat(5000),
      reply: 'r'.repeat(5000),
      durationMs: 100 + i,
      tokens: 10,
      cost: 0.5,
      toolNames: [`t${i}`],
    })),
  };

  it('applies the caps and keeps the numbers', () => {
    const s = buildSummary('title', base, true);
    expect(s).toMatchObject({
      title: 'title',
      attempts: 10,
      passed: 7,
      passRate: 0.7,
      totalTokens: 300,
      judgeTokens: 3,
      cost: 15,
      slowestMs: 129,
    });
    expect(s.toolNames).toHaveLength(30);
    expect(s.failures).toHaveLength(5);
    expect(s.failures[0].message.length).toBe(203);
    expect(s.transcript).toHaveLength(20);
    expect(s.transcript[0].prompt.length).toBe(4099);
    expect(JSON.stringify(s)).not.toContain('raw');
  });

  it('caps tool names at 50', () => {
    const sends = Array.from({ length: 60 }, (_, i) => ({
      ...base.sends[0],
      toolNames: [`t${i}`],
    }));
    expect(buildSummary('t', { ...base, sends }, true).toolNames).toHaveLength(
      50,
    );
  });

  it('counts one attempt from the test outcome when repeat was not used, and omits cost without one', () => {
    const state = newState();
    expect(buildSummary('t', state, true)).toMatchObject({
      attempts: 1,
      passed: 1,
      passRate: 1,
      slowestMs: 0,
    });
    const failed = buildSummary(
      't',
      {
        ...state,
        sends: [{ ...base.sends[0], cost: undefined, error: 'HTTP 500' }],
      },
      false,
    );
    expect(failed).toMatchObject({ attempts: 1, passed: 0, passRate: 0 });
    expect(failed).not.toHaveProperty('cost');
    expect(failed.transcript[0].reply).toBe('error: HTTP 500');
  });
});

describe('redactedJson (C6)', () => {
  it('removes every secret, including escaped forms and ones not from getSecret', () => {
    const out = redactedJson(
      {
        reply: 'key is sk-live-123 and tok"en\\x',
        nested: ['Bearer sk-live-123'],
      },
      ['sk-live-123', 'tok"en\\x'],
    );
    expect(out).not.toContain('sk-live-123');
    expect(out).not.toContain('tok');
    expect(JSON.parse(out).reply).toBe('key is [REDACTED] and [REDACTED]');
  });
});

describe('redaction edge cases', () => {
  it('leaves numbers intact when a header value is short or numeric', () => {
    const state = newState();
    // as secretsOf would build it for headers { 'x-api-version': '2' } and { 'x-token': 'abcd1234' }
    state.secrets.push(
      ...secretsOf({
        headers: {
          'x-api-version': '2',
          'x-trace': '34',
          'x-token': 'abcd1234',
        },
      }),
    );
    expect(state.secrets).toEqual(['abcd1234']);
    const summary = buildSummary(
      't',
      {
        ...state,
        sends: [
          {
            attempt: 1,
            prompt: 'p',
            reply: 'abcd1234 134',
            durationMs: 2,
            tokens: 1234,
            toolNames: [],
          },
        ],
      },
      true,
    );
    const parsed = JSON.parse(redactedJson(summary, state.secrets));
    expect(parsed.totalTokens).toBe(1234);
    expect(parsed.transcript[0].reply).toBe('[REDACTED] 134');
  });

  it('redacts before clipping so a key at the boundary cannot survive in part', () => {
    const key = 'sk-abcdefghijklmnop';
    const state = {
      ...newState(),
      secrets: [key],
      sends: [
        {
          attempt: 1,
          prompt: `${'p'.repeat(4080)}${key}`,
          reply: 'r',
          durationMs: 1,
          tokens: 1,
          toolNames: [],
        },
      ],
    };
    const prompt = buildSummary('t', state, true).transcript[0].prompt;
    expect(prompt).not.toContain('sk-');
    expect(prompt).toContain('[REDACTED]');
  });

  it('treats URL credentials as secrets and ignores plain headers', () => {
    expect(
      secretsOf({
        url: 'https://bot:p%40ss-word@example.com/x',
        headers: { 'content-language': 'english' },
      } as never),
    ).toEqual(['bot', 'p%40ss-word', 'p@ss-word'].filter((v) => v.length >= 4));
  });
});

describe('agent fixture', () => {
  let dir: string;
  let server: http.Server;
  let url: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        // a leaky agent: echoes the key it was given back in its reply
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            text: `you sent ${req.headers.authorization} and ${String(req.headers['x-token'])}`,
            secret: 'k-from-literal',
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });

  const info = (status: string, attach = jest.fn()) => ({
    title: 'my test',
    status,
    outputPath: (name: string) => join(dir, name),
    attach,
  });

  it('writes a redacted plain-JSON summary and attaches it by path', async () => {
    const attach = jest.fn();
    await fixture(
      {},
      async (agent) => {
        const bot = agent.connect({
          kind: 'http',
          url,
          body: (m: string) => ({ m }),
          reply: 'text',
          apiKey: 'k-from-literal',
          headers: { 'x-token': 'hdr-value-9' },
        });
        await agent.repeat(2, async () => {
          await bot.send('hi k-from-literal');
        });
      },
      info('passed', attach),
    );

    expect(attach).toHaveBeenCalledWith('agent-summary', {
      path: join(dir, 'agent-summary.json'),
      contentType: 'application/json',
    });
    const text = await readFile(join(dir, 'agent-summary.json'), 'utf8');
    for (const secret of ['k-from-literal', 'hdr-value-9'])
      expect(text).not.toContain(secret);
    const summary = JSON.parse(text);
    expect(summary).toMatchObject({
      title: 'my test',
      attempts: 2,
      passed: 2,
      passRate: 1,
    });
    expect(summary.transcript[0].reply).toContain('[REDACTED]');
  });

  it('never fails the test when the summary cannot be written', async () => {
    await expect(
      fixture({}, async () => undefined, {
        ...info('failed'),
        outputPath: () => join(dir, 'missing-dir', 'agent-summary.json'),
      }),
    ).resolves.toBeUndefined();
  });
});
