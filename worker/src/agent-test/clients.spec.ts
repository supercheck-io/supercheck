import * as http from 'http';
import type { AddressInfo } from 'net';
import { createAgent, newState } from './agent';
import { redact } from './clients';

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
        timeoutMs: 9_999_999,
        apiKey: 'k',
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
      apiKey: 'k',
    }).send('ping');
    expect(seen.map((s) => s.body.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call',
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

it('rejects an unknown kind and redacts secrets from text', async () => {
  await expect(connect({ kind: 'nope' }).send('x')).rejects.toThrow(
    'Unknown agent kind: nope',
  );
  expect(redact('a sk-1 b sk-1-long', ['sk-1', 'sk-1-long'])).toBe(
    'a [REDACTED] b [REDACTED]',
  );
});
