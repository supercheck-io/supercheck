jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(() =>
    Promise.reject(
      Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
    ),
  ),
}));

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { MonitorConfig } from '../db/schema/types';
import type { McpRequest } from '../common/mcp/mcp-http-client';
import { executeMcpCheck } from './mcp-check';
import { createMcpMonitorRequest } from './mcp-monitor-transport';
import { SECRET_OVER_HTTP_MESSAGE } from './monitor-secret';

const SECRET = 'sk-test-SECRET-value-1234';

type Behavior = {
  protocol: '2026' | '2025' | 'none';
  expectHeader?: [string, string];
  serverName?: string;
  tools?: Array<Record<string, unknown>>;
  pages?: boolean;
  listError?: number;
  bigList?: boolean;
  call?: (args: Record<string, unknown>) => Record<string, unknown>;
  callError?: number;
  status?: number;
  redirect?: boolean;
};

describe('executeMcpCheck', () => {
  let server: Server;
  let url: string;
  let b: Behavior;
  let seen: Array<{
    method?: string;
    http: string;
    headers: IncomingMessage['headers'];
    params?: Record<string, any>;
  }>;

  const reply = (
    res: ServerResponse,
    id: unknown,
    result: unknown,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(200, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
  };
  const fail = (
    res: ServerResponse,
    id: unknown,
    code: number,
    status = 200,
    data?: unknown,
  ) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code, message: `server says ${SECRET}`, data },
      }),
    );
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const body = raw
          ? (JSON.parse(raw) as {
              id?: number;
              method?: string;
              params?: Record<string, any>;
            })
          : {};
        seen.push({
          method: body.method,
          http: req.method!,
          headers: req.headers,
          params: body.params,
        });
        if (b.redirect) {
          res.writeHead(302, { location: 'http://127.0.0.1:1/' });
          return res.end();
        }
        if (b.status) {
          res.writeHead(b.status);
          return res.end('denied');
        }
        if (
          b.expectHeader &&
          req.headers[b.expectHeader[0]] !== b.expectHeader[1]
        ) {
          res.writeHead(401);
          return res.end('no');
        }
        if (b.protocol === 'none') {
          res.writeHead(200, { 'content-type': 'text/plain' });
          return res.end('hello');
        }
        if (req.method === 'DELETE') {
          res.writeHead(204);
          return res.end();
        }
        const id = body.id;
        const info = { name: b.serverName ?? 'Fixture', version: '2.0' };
        if (b.protocol === '2025') {
          if (req.headers['mcp-method']) return fail(res, id, -32601, 400);
          if (body.method === 'initialize')
            return reply(
              res,
              id,
              { protocolVersion: '2025-06-18', serverInfo: info },
              { 'mcp-session-id': 's1' },
            );
          if (body.method === 'notifications/initialized') {
            res.writeHead(202);
            return res.end();
          }
        } else {
          if (body.method === 'server/discover')
            return reply(res, id, {
              supportedVersions: ['2026-07-28'],
              _meta: { 'io.modelcontextprotocol/serverInfo': info },
            });
          if (req.headers['mcp-protocol-version'] !== '2026-07-28')
            return fail(res, id, -32022, 400, { supported: ['2026-07-28'] });
        }
        if (body.method === 'tools/list') {
          if (b.listError) return fail(res, id, b.listError);
          if (b.bigList) {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: {
                  tools: [
                    { name: 'x', description: 'd'.repeat(3 * 1024 * 1024) },
                  ],
                },
              }),
            );
          }
          if (b.pages)
            return reply(res, id, {
              tools: [{ name: `t${seen.length}` }],
              nextCursor: 'more',
            });
          return reply(res, id, {
            tools: b.tools ?? [
              {
                name: 'search_docs',
                description: 'Search',
                inputSchema: { type: 'object' },
              },
            ],
          });
        }
        if (body.method === 'tools/call') {
          if (b.callError) return fail(res, id, b.callError);
          return reply(
            res,
            id,
            (
              b.call ??
              (() => ({ content: [{ type: 'text', text: 'Result: PONG' }] }))
            )(body.params?.arguments ?? {}),
          );
        }
        return fail(res, id, -32601);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  afterAll(() => new Promise((r) => server.close(r)));
  beforeEach(() => {
    b = { protocol: '2026' };
    seen = [];
    process.env.ALLOW_INTERNAL_TARGETS = 'true';
  });
  afterEach(() => delete process.env.ALLOW_INTERNAL_TARGETS);

  const resolveSecret = jest.fn();
  const run = (
    mcp: Partial<NonNullable<MonitorConfig['mcp']>> = {},
    extra: Partial<MonitorConfig> = {},
    target = url,
    request: McpRequest = createMcpMonitorRequest(),
  ) =>
    executeMcpCheck(
      target,
      { mcp: { auth: { type: 'none' }, ...mcp }, ...extra },
      { request, resolveSecret },
    );
  beforeEach(() => {
    resolveSecret.mockReset();
    resolveSecret.mockResolvedValue({ ok: true, value: SECRET });
  });

  describe('success', () => {
    it('checks a 2026 server and records protocol, server, tools, hash and phase timings', async () => {
      const r = await run({ toolCall: { name: 'ping', arguments: { a: 1 } } });
      expect(r).toMatchObject({ status: 'up', isUp: true });
      expect(r.details.errorMessage).toBeUndefined();
      expect(r.details.mcp).toMatchObject({
        protocol: '2026-07-28',
        serverName: 'Fixture',
        serverVersion: '2.0',
        toolCount: 1,
      });
      expect(r.details.mcp.failure).toBeUndefined();
      expect(r.details.mcp.toolsHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.details.mcp.tools).toHaveLength(1);
      expect(r.details.mcp.tools![0].name).toBe('search_docs');
      for (const k of ['connectMs', 'listMs', 'callMs'] as const)
        expect(r.details.mcp[k]).toBeGreaterThanOrEqual(0);
      expect(r.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(r.details)).not.toContain('Search'); // descriptions are hashed, never stored
      expect(seen.some((s) => s.http === 'DELETE')).toBe(false);
    });

    it('checks a 2025 server with the handshake and closes the session', async () => {
      b.protocol = '2025';
      const r = await run();
      expect(r.status).toBe('up');
      expect(r.details.mcp.protocol).toBe('2025-06-18');
      expect(seen.map((s) => s.method ?? s.http)).toEqual([
        'server/discover',
        'initialize',
        'notifications/initialized',
        'tools/list',
        'DELETE',
      ]);
      expect(seen[3].headers['mcp-session-id']).toBe('s1');
    });

    it('forces a protocol and reuses the remembered mode without a probe', async () => {
      await run({ protocol: '2026' });
      expect(seen.map((s) => s.method)).toEqual([
        'server/discover',
        'tools/list',
      ]);
      seen = [];
      await run({}, { mcpState: { detectedProtocol: '2026' } });
      expect(seen.map((s) => s.method)).toEqual([
        'server/discover',
        'tools/list',
      ]);
      seen = [];
      b.protocol = '2025';
      await run({ protocol: '2025' });
      expect(seen[0].method).toBe('initialize');
    });

    it('re-detects once when the remembered mode no longer fits', async () => {
      b.protocol = '2025';
      const r = await run({}, { mcpState: { detectedProtocol: '2026' } });
      expect(r.status).toBe('up');
      expect(r.details.mcp.protocol).toBe('2025-06-18');
    });

    it('sorts, dedupes and caps the tool list at 500 while counting every tool', async () => {
      b.tools = [
        ...Array.from({ length: 600 }, (_, i) => ({
          name: `tool_${String(i).padStart(3, '0')}`,
        })),
        { name: 'tool_000', description: 'duplicate name' },
        { description: 'no name' },
        { name: 'z'.repeat(200) },
      ];
      const r = await run();
      expect(r.details.mcp.tools).toHaveLength(500);
      expect(r.details.mcp.toolCount).toBe(601);
      expect(r.details.mcp.tools![0].name).toBe('tool_000');
      expect(r.details.mcp.tools!.every((t) => t.name.length <= 128)).toBe(
        true,
      );
    });

    it('hashes the whole list: a change on tool 550 of 600 changes the hash though only 500 are stored', async () => {
      const list = (desc: string) =>
        Array.from({ length: 600 }, (_, i) => ({
          name: `tool_${String(i).padStart(3, '0')}`,
          description: i === 550 ? desc : 'same',
        }));
      b.tools = list('before');
      const one = await run();
      b.tools = list('after');
      const two = await run();
      expect(one.details.mcp.tools).toHaveLength(500);
      expect(two.details.mcp.tools).toEqual(one.details.mcp.tools);
      expect(two.details.mcp.toolsHash).not.toBe(one.details.mcp.toolsHash);
    });

    it('a tools/list reply without a tools array is failure list', async () => {
      b.tools = undefined;
      const request: McpRequest = (_u, init, read) => {
        const m = (JSON.parse(init.body as string) as { method: string })
          .method;
        return read(
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result:
                m === 'server/discover'
                  ? { supportedVersions: ['2026-07-28'] }
                  : {},
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      };
      const r = await run({}, {}, url, request);
      expect(r.status).toBe('down');
      expect(r.details.mcp.failure).toBe('list');
      expect(r.details.errorMessage).toBe('Could not list tools');
    });

    it('fails when pages remain after 10: no partial list or baseline', async () => {
      b.pages = true;
      const r = await run({ requiredTools: ['t1'] });
      expect(r.status).toBe('down');
      expect(r.details.mcp.failure).toBe('list');
      expect(r.details.errorMessage).toBe(
        'The server lists more tools than Supercheck reads (10 pages)',
      );
      expect(r.details.mcp.toolsHash).toBeUndefined();
      expect(seen.filter((s) => s.method === 'tools/list')).toHaveLength(10);
    });

    it('an assertion on the reply text is case-insensitive and can read structured content', async () => {
      expect(
        (await run({ toolCall: { name: 'ping', expectText: 'pong' } })).status,
      ).toBe('up');
      b.call = () => ({
        content: [],
        structuredContent: { answer: 'Forty-Two' },
      });
      expect(
        (await run({ toolCall: { name: 'ping', expectText: 'forty-two' } }))
          .status,
      ).toBe('up');
    });
  });

  describe('login', () => {
    it('sends a bearer token as Authorization and the raw secret in a custom header', async () => {
      b.expectHeader = ['authorization', `Bearer ${SECRET}`];
      expect(
        (await run({ auth: { type: 'bearer', secretKey: 'TOKEN' } })).status,
      ).toBe('up');
      expect(resolveSecret).toHaveBeenCalledWith('TOKEN');
      b.expectHeader = ['x-api-key', SECRET];
      expect(
        (
          await run({
            auth: {
              type: 'header',
              secretKey: 'TOKEN',
              headerName: 'X-Api-Key',
            },
          })
        ).status,
      ).toBe('up');
    });

    it('does not look up a secret for no login', async () => {
      await run();
      expect(resolveSecret).not.toHaveBeenCalled();
    });

    it.each([401, 403])('maps HTTP %i to failure auth', async (status) => {
      b.status = status;
      const r = await run();
      expect(r).toMatchObject({ status: 'down', isUp: false });
      expect(r.details.mcp.failure).toBe('auth');
      expect(r.details.errorMessage).toBe(`Login failed (${status})`);
    });

    it('a wrong token shows Login failed without echoing it', async () => {
      b.expectHeader = ['authorization', 'Bearer other'];
      const r = await run({ auth: { type: 'bearer', secretKey: 'TOKEN' } });
      expect(r.details.errorMessage).toBe('Login failed (401)');
      expect(JSON.stringify(r)).not.toContain(SECRET);
    });
  });

  describe('secret failures', () => {
    it('reports a missing or unusable secret as a check error', async () => {
      resolveSecret.mockResolvedValue({
        ok: false,
        message: 'The project secret for this monitor was not found',
      });
      const r = await run({ auth: { type: 'bearer', secretKey: 'GONE' } });
      expect(r).toMatchObject({ status: 'error', isUp: false });
      expect(r.details.mcp.failure).toBe('secret');
      expect(r.details.errorMessage).toBe(
        'The project secret for this monitor was not found',
      );
      expect(seen).toHaveLength(0);
    });

    it('never sends a secret over plain http outside internal-target mode', async () => {
      delete process.env.ALLOW_INTERNAL_TARGETS;
      const r = await run({ auth: { type: 'bearer', secretKey: 'TOKEN' } });
      expect(r.details.mcp.failure).toBe('secret');
      expect(r.details.errorMessage).toBe(SECRET_OVER_HTTP_MESSAGE);
      expect(resolveSecret).not.toHaveBeenCalled();
      expect(seen).toHaveLength(0);
    });

    it('requires a secret name, and a header name for header login', async () => {
      expect(
        (await run({ auth: { type: 'bearer' } })).details.errorMessage,
      ).toMatch(/secret is required/);
      expect(
        (
          await run({
            auth: { type: 'header', secretKey: 'K', headerName: ' ' },
          })
        ).details.errorMessage,
      ).toMatch(/header name is required/);
      expect(
        (await run({ auth: { type: 'header', secretKey: 'K' } })).details.mcp
          .failure,
      ).toBe('secret');
    });

    it('refuses header names and values that could not be sent safely', async () => {
      for (const headerName of ['Host', 'Content-Length', 'bad name!']) {
        const r = await run({
          auth: { type: 'header', secretKey: 'K', headerName },
        });
        expect(r.details.errorMessage).toBe(
          'The header name or secret cannot be sent',
        );
        expect(r.status).toBe('error');
      }
      resolveSecret.mockResolvedValue({ ok: true, value: 'line\nbreak-value' });
      expect(
        (await run({ auth: { type: 'bearer', secretKey: 'K' } })).details.mcp
          .failure,
      ).toBe('secret');
      expect(seen).toHaveLength(0);
    });

    it('scrubs the secret from every stored field the server controls', async () => {
      b.serverName = `name-${SECRET}`;
      b.tools = [{ name: `tool_${SECRET}`, description: SECRET }];
      b.expectHeader = ['authorization', `Bearer ${SECRET}`];
      const r = await run({
        auth: { type: 'bearer', secretKey: 'TOKEN' },
        requiredTools: ['nope'],
      });
      expect(JSON.stringify(r)).not.toContain(SECRET);
      expect(r.details.mcp.serverName).toContain('***');
      // Also on the failure paths that carry server data (rpc error text is never copied).
      b.listError = -32000;
      expect(
        JSON.stringify(
          await run({ auth: { type: 'bearer', secretKey: 'TOKEN' } }),
        ),
      ).not.toContain(SECRET);
    });
  });

  describe('connect failures', () => {
    it('refused connection', async () => {
      const closed = createServer();
      await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
      const port = (closed.address() as AddressInfo).port;
      await new Promise((r) => closed.close(r));
      const r = await run({}, {}, `http://127.0.0.1:${port}/mcp`);
      expect(r).toMatchObject({ status: 'down', isUp: false });
      expect(r.details.mcp.failure).toBe('connect');
      expect(r.details.errorMessage).toBe('Could not connect to an MCP server');
    });

    it('DNS failure', async () => {
      const r = await run({}, {}, 'https://no-such-host.example.test/mcp');
      expect(r.status).toBe('down');
      expect(r.details.mcp.failure).toBe('connect');
      expect(r.details.errorMessage).toBe('DNS lookup failed');
    });

    it('a reply that is not MCP', async () => {
      b.protocol = 'none';
      const r = await run();
      expect(r.status).toBe('down');
      expect(r.details.mcp.failure).toBe('connect');
    });

    it('a reply that is too large', async () => {
      b.bigList = true;
      const r = await run();
      expect(r.details.mcp.failure).toBe('list');
      expect(r.details.errorMessage).toBe(
        'Could not list tools: reply too large',
      );
    });

    it('a server with no supported protocol version', async () => {
      const request: McpRequest = (_u, _i, read) =>
        read(
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              error: { code: -32022, data: { supported: ['2024-11-05'] } },
            }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          ),
        );
      const r = await run({}, {}, url, request);
      expect(r.details.mcp.failure).toBe('connect');
      expect(r.details.errorMessage).toBe('No supported MCP protocol version');
    });

    it('a redirect is not followed and is a down result', async () => {
      b.redirect = true;
      const r = await run();
      expect(r.status).toBe('down');
      expect(r.details.mcp.failure).toBe('connect');
      expect(r.details.errorMessage).toBe('Redirect not followed');
    });

    it('a private target, and plain http in cloud mode, are check errors rather than outages', async () => {
      delete process.env.ALLOW_INTERNAL_TARGETS;
      const priv = await run({}, {}, 'https://10.0.0.5/mcp');
      expect(priv.status).toBe('error');
      expect(priv.details.mcp.failure).toBe('connect');
      expect(priv.details.errorMessage).toMatch(/private or reserved/);
      const http = await run();
      expect(http.status).toBe('error');
      expect(http.details.errorMessage).toBe('MCP URL must use https');
      const meta = await run({}, {}, 'https://169.254.169.254/latest');
      expect(meta.status).toBe('error');
    });

    it('URL credentials are refused', async () => {
      const r = await run({}, {}, 'https://user:pw@mcp.example.test/mcp');
      expect(r.status).toBe('error');
      expect(r.details.errorMessage).toBe(
        'MCP URLs cannot include credentials',
      );
    });
  });

  describe('list, required tool, call and assert failures', () => {
    it('JSON-RPC error on tools/list is failure list and never copies the server text', async () => {
      b.listError = -32000;
      const r = await run();
      expect(r).toMatchObject({ status: 'down' });
      expect(r.details.mcp.failure).toBe('list');
      expect(r.details.errorMessage).toBe(
        'Could not list tools (error -32000)',
      );
      expect(r.details.errorMessage).not.toContain('server says');
    });

    it('a non-RPC failure on tools/list has no code suffix', async () => {
      const request: McpRequest = (_u, init, read) => {
        const method = (JSON.parse(init.body as string) as { method: string })
          .method;
        if (method === 'server/discover')
          return read(
            new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                result: { supportedVersions: ['2026-07-28'] },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        return read(new Response('boom', { status: 500 }));
      };
      expect((await run({}, {}, url, request)).details.errorMessage).toBe(
        'Could not list tools',
      );
    });

    it('a missing required tool names it', async () => {
      const r = await run({ requiredTools: ['search_docs', 'get_page'] });
      expect(r.status).toBe('down');
      expect(r.details.mcp.failure).toBe('required_tool');
      expect(r.details.errorMessage).toBe('Tool get_page is missing');
      // The tool list is still recorded so the detail page can show what the server does offer.
      expect(r.details.mcp.toolCount).toBe(1);
      const two = await run({ requiredTools: ['a', 'b'] });
      expect(two.details.errorMessage).toBe('Tools a, b are missing');
    });

    it('a present required tool passes', async () => {
      expect((await run({ requiredTools: ['search_docs'] })).status).toBe('up');
    });

    it('isError is failure call', async () => {
      b.call = () => ({
        isError: true,
        content: [{ type: 'text', text: `bad ${SECRET}` }],
      });
      const r = await run({ toolCall: { name: 'ping' } });
      expect(r.status).toBe('down');
      expect(r.details.mcp.failure).toBe('call');
      expect(r.details.errorMessage).toBe('Tool ping returned an error');
    });

    it('a JSON-RPC error on tools/call is failure call', async () => {
      b.callError = -32602;
      const r = await run({ toolCall: { name: 'ping' } });
      expect(r.details.mcp.failure).toBe('call');
      expect(r.details.errorMessage).toBe('Tool call failed (error -32602)');
    });

    it('input_required is a failed call, and an invalid tool name never reaches the server', async () => {
      b.call = () => ({ resultType: 'input_required' });
      expect(
        (await run({ toolCall: { name: 'ping' } })).details.mcp.failure,
      ).toBe('call');
      seen = [];
      const bad = await run({ toolCall: { name: 'bad name' } });
      expect(bad.details.mcp.failure).toBe('call');
      expect(seen.filter((s) => s.method === 'tools/call')).toHaveLength(0);
    });

    it('missing expected text is failure assert', async () => {
      const r = await run({ toolCall: { name: 'ping', expectText: 'absent' } });
      expect(r.status).toBe('down');
      expect(r.details.mcp.failure).toBe('assert');
      expect(r.details.errorMessage).toBe(
        'Result did not contain the expected text',
      );
      expect(r.details.mcp.callMs).toBeGreaterThanOrEqual(0);
    });

    it('a result with no text and an expectation fails the assertion', async () => {
      b.call = () => ({ content: [{ type: 'image' }, 'junk'] });
      expect(
        (await run({ toolCall: { name: 'ping', expectText: 'x' } })).details.mcp
          .failure,
      ).toBe('assert');
      b.call = () => ({});
      expect(
        (await run({ toolCall: { name: 'ping', expectText: 'x' } })).details.mcp
          .failure,
      ).toBe('assert');
    });
  });

  describe('timeout and settings', () => {
    it('reports a timeout with the configured deadline', async () => {
      const request: McpRequest = () =>
        Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }));
      const r = await run({}, { timeoutSeconds: 7 }, url, request);
      expect(r).toMatchObject({ status: 'timeout', isUp: false });
      expect(r.details.mcp.failure).toBe('timeout');
      expect(r.details.errorMessage).toBe('Timed out after 7 s');
    });

    it('clamps the deadline to 5-60 seconds and defaults to 30', async () => {
      const request: McpRequest = () =>
        Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }));
      expect(
        (await run({}, { timeoutSeconds: 1 }, url, request)).details
          .errorMessage,
      ).toBe('Timed out after 5 s');
      expect(
        (await run({}, { timeoutSeconds: 500 }, url, request)).details
          .errorMessage,
      ).toBe('Timed out after 60 s');
      expect((await run({}, {}, url, request)).details.errorMessage).toBe(
        'Timed out after 30 s',
      );
    });

    it('a monitor with no MCP settings is a check error', async () => {
      const r = await executeMcpCheck(
        url,
        {},
        { request: createMcpMonitorRequest(), resolveSecret },
      );
      expect(r).toMatchObject({ status: 'error', isUp: false });
      expect(r.details.errorMessage).toBe('MCP settings are missing');
      expect(r.details.mcp.failure).toBeUndefined();
    });

    it('caps the message at 300 characters', async () => {
      const long = 'x'.repeat(400);
      const r = await run({ requiredTools: [long] });
      expect(r.details.errorMessage!.length).toBe(300);
    });
  });
});
