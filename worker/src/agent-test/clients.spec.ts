import * as http from 'http';
import type { AddressInfo } from 'net';
import { createAgent, newState } from './agent';
import { getDefaultAutoSelectFamilyAttemptTimeout } from 'net';
import {
  CONNECT_ATTEMPT_MS,
  createClient,
  encodedForms,
  MAX_REPLY_BYTES,
  redact,
} from './clients';

type Handler = (
  req: http.IncomingMessage,
  body: any,
  res: http.ServerResponse,
) => void;

let server: http.Server;
let handler: Handler;
let seen: { headers: http.IncomingHttpHeaders; body: any }[];
let url: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      seen.push({ headers: req.headers, body });
      // MCP session close: answered here so per-test handlers only see POSTs.
      if (req.method === 'DELETE') {
        res.writeHead(204);
        return res.end();
      }
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/x`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  seen = [];
});

const json = (res: http.ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const connect = (options: any) => createAgent(newState()).connect(options);

const rpcReply = (
  res: http.ServerResponse,
  id: number,
  result: unknown,
  sse = false,
) => {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  if (sse) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      `event: message\ndata: {"jsonrpc":"2.0","method":"ping"}\n\nevent: message\ndata: ${msg}\n\n`,
    );
  } else json(res, JSON.parse(msg));
};

it('gives each address of a far-away agent 2 s to connect, not the 250 ms Node default', () => {
  expect(getDefaultAutoSelectFamilyAttemptTimeout()).toBeGreaterThanOrEqual(
    CONNECT_ATTEMPT_MS,
  );
});

describe('openai client', () => {
  it('returns text, tool calls and usage, and sends key, model, system and history', async () => {
    handler = (_req, _body, res) =>
      json(res, {
        choices: [
          {
            message: {
              content: 'Refunds within 30 days.',
              tool_calls: [
                {
                  function: { name: 'lookup', arguments: '{"id":7}' },
                },
                { function: { name: 'raw', arguments: 'not json' } },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          cost: 0.002,
        },
      });
    const bot = connect({
      kind: 'openai',
      url,
      apiKey: 'sk-secret',
      model: 'm',
      system: 'be brief',
      tools: [{ type: 'function' }],
      headers: { 'x-team': 'a' },
    });
    const r = await bot.send('policy?', {
      conversation: [{ role: 'user', content: 'hi' }],
    });
    expect(r.text).toBe('Refunds within 30 days.');
    expect(r.toolCalls).toEqual([
      { name: 'lookup', arguments: { id: 7 } },
      { name: 'raw', arguments: 'not json' },
    ]);
    expect(r.toolNames).toEqual(['lookup', 'raw']);
    expect(r.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cost: 0.002,
    });
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(seen[0].headers.authorization).toBe('Bearer sk-secret');
    expect(seen[0].headers['x-team']).toBe('a');
    expect(seen[0].body).toMatchObject({
      model: 'm',
      tools: [{ type: 'function' }],
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
        { role: 'user', content: 'policy?' },
      ],
    });
  });

  it('copes with a reply that has no choices or usage', async () => {
    handler = (_r, _b, res) => json(res, {});
    const r = await connect({ kind: 'openai', url, model: 'm' }).send('x');
    expect(r.text).toBe('');
    expect(r.usage.totalTokens).toBe(0);
    expect(r.toolNames).toEqual([]);
  });

  it('throws status and a short body, never the key', async () => {
    handler = (_r, _b, res) =>
      json(res, { error: `bad key sk-secret ${'x'.repeat(500)}` }, 401);
    const error = await connect({
      kind: 'openai',
      url,
      apiKey: 'sk-secret',
      model: 'm',
    })
      .send('x')
      .catch((e: Error) => e);
    expect((error as Error).message).toMatch(/^openai agent replied HTTP 401/);
    expect((error as Error).message).not.toContain('sk-secret');
    expect((error as Error).message.length).toBeLessThan(300);
  });

  it('throws when the reply is not JSON', async () => {
    handler = (_r, _b, res) => res.end('<html>');
    await expect(
      connect({ kind: 'openai', url, model: 'm' }).send('x'),
    ).rejects.toThrow('not JSON');
  });

  it('times out with a clear message', async () => {
    handler = () => undefined; // never answers
    await expect(
      connect({ kind: 'openai', url, model: 'm', timeoutMs: 50 }).send('x'),
    ).rejects.toThrow('timed out after 50ms');
  });

  it('caps the timeout at 120 s and reports a refused connection', async () => {
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((r) => closed.close(r));
    await expect(
      connect({
        kind: 'openai',
        url: `http://127.0.0.1:${port}/x`,
        model: 'm',
        timeoutMs: 120_000,
        apiKey: 'key-1234',
      }).send('x'),
    ).rejects.toThrow(/request failed: ECONNREFUSED/);
  });
});

describe('http client', () => {
  it('posts body(message) and reads the reply path', async () => {
    handler = (_r, _b, res) =>
      json(res, { data: { answer: 'hello' }, list: [{ t: 'a' }], n: 3 });
    const bot = connect({
      kind: 'http',
      url,
      body: (m: string) => ({ q: m }),
      reply: 'data.answer',
    });
    const r = await bot.send('hi');
    expect(seen[0].body).toEqual({ q: 'hi' });
    expect(r.text).toBe('hello');
    expect(r.json).toMatchObject({ n: 3 });
    expect(r.toolNames).toEqual([]);
    expect(r.usage.totalTokens).toBe(0);

    const second = await connect({
      kind: 'http',
      url,
      body: () => ({}),
      reply: 'list.0',
    }).send('x');
    expect(second.text).toBe('{"t":"a"}');
  });

  it('throws when the path is missing, the reply is not JSON, or the status is bad', async () => {
    const bot = connect({ kind: 'http', url, body: () => ({}), reply: 'nope' });
    handler = (_r, _b, res) => json(res, { a: 1 });
    await expect(bot.send('x')).rejects.toThrow('nothing at "nope"');
    handler = (_r, _b, res) => res.end('plain');
    await expect(bot.send('x')).rejects.toThrow('not JSON');
    handler = (_r, _b, res) => json(res, { a: 1 }, 500);
    await expect(bot.send('x')).rejects.toThrow('HTTP 500');
  });
});

describe('a2a client', () => {
  it('sends 1.0 SendMessage and reads a task with status message and artifacts', async () => {
    handler = (_r, body, res) =>
      json(res, {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          task: {
            status: { message: { parts: [{ text: 'done' }] } },
            artifacts: [{ parts: [{ text: 'artifact' }] }],
            history: [
              {
                parts: [
                  { text: 'thinking' },
                  { data: { name: 'search', arguments: { q: 1 } } },
                  { data: { name: 'no-args' } },
                  { data: { name: 'by-input', input: 'i' } },
                ],
              },
              {},
            ],
          },
        },
      });
    const r = await connect({ kind: 'a2a', url }).send('hello');
    expect(seen[0].body.method).toBe('SendMessage');
    expect(seen[0].body.params.message).toMatchObject({
      role: 'ROLE_USER',
      parts: [{ text: 'hello' }],
    });
    expect(seen[0].headers['a2a-version']).toBe('1.0');
    expect(r.text).toBe('done\nartifact');
    expect(r.toolCalls).toEqual([
      { name: 'search', arguments: { q: 1 } },
      { name: 'by-input', arguments: 'i' },
    ]);
  });

  it('sends the 0.3 message/send when legacy and reads a message reply', async () => {
    handler = (_r, body, res) =>
      json(res, {
        jsonrpc: '2.0',
        id: body.id,
        result: { kind: 'message', parts: [{ kind: 'text', text: 'hi back' }] },
      });
    const r = await connect({ kind: 'a2a', url, legacy: true }).send('hello');
    expect(seen[0].body.method).toBe('message/send');
    expect(seen[0].body.params.message).toMatchObject({
      kind: 'message',
      role: 'user',
      parts: [{ kind: 'text', text: 'hello' }],
    });
    expect(seen[0].headers['a2a-version']).toBeUndefined();
    expect(r.text).toBe('hi back');
  });

  it('reads a 1.0 message reply and throws a JSON-RPC error', async () => {
    handler = (_r, body, res) =>
      json(res, {
        jsonrpc: '2.0',
        id: body.id,
        result: { message: { parts: [{ text: 'm' }] } },
      });
    expect((await connect({ kind: 'a2a', url }).send('x')).text).toBe('m');
    handler = (_r, body, res) =>
      json(res, {
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32001, message: 'no such task' },
      });
    await expect(connect({ kind: 'a2a', url }).send('x')).rejects.toThrow(
      'a2a agent error -32001: no such task',
    );
  });

  it('redacts the key from a JSON-RPC error message', async () => {
    handler = (_r, body, res) =>
      json(res, {
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32001, message: 'bad key sk-secret-key' },
      });
    await expect(
      connect({ kind: 'a2a', url, apiKey: 'sk-secret-key' }).send('x'),
    ).rejects.toThrow('a2a agent error -32001: bad key [REDACTED]');
  });
});

describe('mcp client', () => {
  it('closes a session that initialize opened even when it answered with an HTTP error', async () => {
    handler = (_req, _body, res) => {
      res.writeHead(500, { 'mcp-session-id': 'sess-err' });
      res.end('boom');
    };
    await expect(
      connect({ kind: 'mcp', url, tool: 'ask' }).send('m'),
    ).rejects.toThrow('mcp agent replied HTTP 500');
    expect(seen.at(-1)?.headers['mcp-session-id']).toBe('sess-err');
    expect(seen.at(-1)?.body).toBeUndefined();
  });

  it('stops reading an SSE reply at its response even if the stream stays open, then closes the session', async () => {
    handler = (_req, body, res) => {
      if (body.method === 'initialize') {
        res.setHeader('mcp-session-id', 'sess-sse');
        return json(res, { jsonrpc: '2.0', id: 1, result: {} });
      }
      if (body.method === 'notifications/initialized') {
        res.writeHead(202);
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'ok' }] } })}\n\n`,
      ); // never ended
    };
    const r = await connect({
      kind: 'mcp',
      url,
      tool: 'ask',
      timeoutMs: 3000,
    }).send('m');
    expect(r.text).toBe('ok');
    expect(seen.at(-1)?.headers['mcp-session-id']).toBe('sess-sse');
    expect(seen.map((s) => s.body?.method ?? 'DELETE')).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call',
      'DELETE',
    ]);
  });

  it('closes the session when the initialize reply is an error', async () => {
    handler = (_r, _b, res) => {
      res.setHeader('mcp-session-id', 'sess-err');
      json(res, {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'no' },
      });
    };
    await expect(
      connect({ kind: 'mcp', url, tool: 'ask' }).send('x'),
    ).rejects.toThrow('mcp agent error -32000');
    expect(seen.map((s) => s.body?.method ?? 'DELETE')).toEqual([
      'initialize',
      'DELETE',
    ]);
    expect(seen[1].headers['mcp-session-id']).toBe('sess-err');
  });

  it('spends one timeout across initialize, initialized and the call', async () => {
    const slow = (ms: number, fn: () => void) => setTimeout(fn, ms);
    handler = (_r, body, res) => {
      if (body.method === 'initialize')
        return void slow(300, () => rpcReply(res, 1, {}));
      if (body.method === 'notifications/initialized')
        return void slow(300, () => {
          res.writeHead(202);
          res.end();
        });
      // tools/call never answers
    };
    const t0 = Date.now();
    await expect(
      connect({ kind: 'mcp', url, tool: 'ask', timeoutMs: 700 }).send('x'),
    ).rejects.toThrow('timed out after 700ms');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('initializes, notifies, then calls the tool with the message as the named argument', async () => {
    handler = (_r, body, res) => {
      if (body.method === 'initialize') {
        res.setHeader('mcp-session-id', 'sess-1');
        return rpcReply(res, body.id, { protocolVersion: '2025-06-18' });
      }
      if (body.method === 'notifications/initialized') {
        res.writeHead(202);
        return res.end();
      }
      rpcReply(res, body.id, {
        content: [{ type: 'text', text: 'pong' }],
        structuredContent: { ok: true },
      });
    };
    const r = await connect({
      kind: 'mcp',
      url,
      tool: 'ask',
      argument: 'q',
      apiKey: 'key-1234',
    }).send('ping');
    expect(seen.map((s) => s.body?.method ?? 'DELETE')).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call',
      'DELETE',
    ]);
    expect(seen[2].headers['mcp-session-id']).toBe('sess-1');
    expect(seen[2].headers['mcp-protocol-version']).toBe('2025-06-18');
    expect(seen[2].body.params).toEqual({
      name: 'ask',
      arguments: { q: 'ping' },
    });
    expect(r.text).toBe('pong');
    expect(r.json).toEqual({ ok: true });
    expect(r.toolNames).toEqual(['ask']);
  });

  it('reads SSE replies, defaults the argument to "message", and works without a session', async () => {
    handler = (_r, body, res) => {
      if (body.method === 'notifications/initialized') {
        res.writeHead(202);
        return res.end();
      }
      rpcReply(
        res,
        body.id,
        body.method === 'initialize' ? {} : { content: [{ text: 'sse' }] },
        true,
      );
    };
    const r = await connect({ kind: 'mcp', url, tool: 'ask' }).send('m');
    expect(seen[2].body.params.arguments).toEqual({ message: 'm' });
    expect(seen[2].headers['mcp-session-id']).toBeUndefined();
    expect(r.text).toBe('sse');
  });

  it('throws on a tool error, a missing response and a JSON-RPC error', async () => {
    const bot = connect({ kind: 'mcp', url, tool: 'ask' });
    const handshake = (body: any, res: http.ServerResponse) => {
      if (body.method === 'notifications/initialized') {
        res.writeHead(202);
        res.end();
        return true;
      }
      if (body.method === 'initialize') {
        rpcReply(res, body.id, {});
        return true;
      }
    };
    handler = (_r, body, res) =>
      handshake(body, res) ||
      rpcReply(res, body.id, { isError: true, content: [{ text: 'boom' }] });
    await expect(bot.send('x')).rejects.toThrow('mcp tool ask failed: boom');
    handler = (_r, body, res) =>
      handshake(body, res) ||
      (res.writeHead(200, { 'content-type': 'text/event-stream' }),
      res.end('data: {"id":99}\n\ndata: oops\n\n'));
    await expect(bot.send('x')).rejects.toThrow('no response to request 2');
    handler = (_r, body, res) =>
      handshake(body, res) ||
      json(res, {
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -1, message: 'denied' },
      });
    await expect(bot.send('x')).rejects.toThrow('mcp agent error -1: denied');
  });
});

it('redacts secrets from text', () => {
  expect(redact('a sk-1 b sk-1-long', ['sk-1', 'sk-1-long'])).toBe(
    'a [REDACTED] b [REDACTED]',
  );
});

it('createClient still refuses an unknown kind', async () => {
  await expect(
    createClient({ kind: 'nope' } as never).send('x'),
  ).rejects.toThrow('Unknown agent kind: nope');
});

describe('connect validation', () => {
  const ok = { kind: 'http', url: 'http://h/x', body: () => ({}), reply: 'a' };
  it.each([
    [{ ...ok, kind: 'nope' }, TypeError, 'kind must be'],
    [{ ...ok, kind: undefined }, TypeError, 'kind must be'],
    [{ ...ok, url: 'not a url' }, TypeError, 'http(s) URL'],
    [{ ...ok, url: undefined }, TypeError, 'http(s) URL'],
    [{ ...ok, url: 'file:///etc/passwd' }, TypeError, 'http(s) URL'],
    [{ ...ok, timeoutMs: 0 }, RangeError, 'timeoutMs'],
    [{ ...ok, timeoutMs: 120_001 }, RangeError, 'timeoutMs'],
    [{ ...ok, timeoutMs: 1.5 }, RangeError, 'timeoutMs'],
    [{ ...ok, timeoutMs: NaN }, RangeError, 'timeoutMs'],
    [{ ...ok, apiKey: 'abc' }, Error, 'at least 4'],
    [{ ...ok, headers: { 'x-api-key': 'ab' } }, Error, 'at least 4'],
    [{ ...ok, headers: { Authorization: 'Bearer x' } }, Error, 'at least 4'],
  ])('rejects %j', (options, type, text) => {
    expect(() => connect(options)).toThrow(type);
    expect(() => connect(options)).toThrow(text);
  });

  it('accepts the bounds and short non-credential headers', () => {
    expect(() =>
      connect({ ...ok, timeoutMs: 1, headers: { 'x-team': 'a' } }),
    ).not.toThrow();
    expect(() =>
      connect({ ...ok, url: 'https://h', timeoutMs: 120_000, apiKey: 'abcd' }),
    ).not.toThrow();
  });
});

describe('request headers', () => {
  it('sends one authorization value when the user header differs in case', async () => {
    handler = (_r, _b, res) => json(res, { text: 'ok' });
    await connect({
      kind: 'http',
      url,
      apiKey: 'key-A-1234',
      headers: { Authorization: 'Bearer user-B-1234' },
      body: () => ({}),
      reply: 'text',
    }).send('x');
    expect(seen[0].headers.authorization).toBe('Bearer user-B-1234');
  });

  it('sends one authorization value on the MCP session close too', async () => {
    handler = (_r, body, res) => {
      if (body.method === 'initialize') {
        res.setHeader('mcp-session-id', 'sess-h');
        return rpcReply(res, body.id, {});
      }
      if (body.method === 'notifications/initialized') {
        res.writeHead(202);
        return res.end();
      }
      rpcReply(res, body.id, { content: [{ text: 'a' }] });
    };
    await connect({
      kind: 'mcp',
      url,
      tool: 't',
      apiKey: 'key-A-1234',
      headers: { Authorization: 'Bearer user-B-1234' },
    }).send('x');
    expect(seen.at(-1)?.headers.authorization).toBe('Bearer user-B-1234');
    expect(seen.at(-1)?.headers['mcp-session-id']).toBe('sess-h');
  });
});

describe('openai reply shapes', () => {
  const bot = () =>
    connect({ kind: 'openai', url, model: 'm', apiKey: 'sk-1234' });
  it('throws a redacted error for a 200 reply carrying an error', async () => {
    handler = (_r, _b, res) =>
      json(res, { error: { message: 'quota sk-1234 exceeded' } });
    const error = await bot()
      .send('x')
      .catch((e: Error) => e);
    expect((error as Error).message).toBe(
      'openai agent error: quota [REDACTED] exceeded',
    );
  });

  it('reads array content parts and falls back to prompt + completion tokens', async () => {
    handler = (_r, _b, res) =>
      json(res, {
        choices: [
          {
            message: { content: [{ text: 'a' }, { type: 'x' }, { text: 'b' }] },
          },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 3 },
      });
    const r = await bot().send('x');
    expect(r.text).toBe('a\nb');
    expect(r.usage.totalTokens).toBe(7);
  });
});

describe('redirects and reply size', () => {
  const bot = () =>
    createClient({
      kind: 'openai',
      url,
      model: 'm',
      headers: { 'x-tenant': 'tenant-secret' },
    });

  it('refuses a redirect instead of following it (it could point at a private address)', async () => {
    handler = (_r, _b, res) => {
      res.writeHead(307, { location: 'http://169.254.169.254/latest' });
      res.end();
    };
    await expect(bot().send('x')).rejects.toThrow(
      'openai agent replied with a redirect (HTTP 307) to http://169.254.169.254/latest',
    );
    expect(seen).toHaveLength(1);
  });

  it('refuses a reply larger than the cap', async () => {
    handler = (_r, _b, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('x'.repeat(MAX_REPLY_BYTES + 1));
    };
    await expect(bot().send('x')).rejects.toThrow(
      `openai agent request failed: reply is larger than ${MAX_REPLY_BYTES} bytes`,
    );
  });
});

describe('encodedForms', () => {
  it('covers URL, JSON and base64 at every byte offset, and drops forms under 4 chars', () => {
    const forms = encodedForms('a b/c"d');
    expect(forms).toEqual(
      expect.arrayContaining([
        'a b/c"d',
        'a%20b%2Fc%22d',
        'a+b%2Fc%22d',
        'a b/c\\"d',
      ]),
    );
    for (const prefix of ['', 'u', 'us', 'usr'])
      expect(
        forms.some((f) =>
          Buffer.from(`${prefix}a b/c"d`).toString('base64').includes(f),
        ),
      ).toBe(true);
    expect(encodedForms('abcd').every((f) => f.length >= 4)).toBe(true);
  });
});
