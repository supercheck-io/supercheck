import {
  McpError,
  McpHttpClient,
  isVersionError,
  type McpClientOptions,
  type McpRequest,
} from './mcp-http-client';

type Seen = { method: string; headers: Headers; body?: Record<string, any> };

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const rpcError = (id: number, code: number, data?: unknown, status = 200) =>
  json(
    {
      jsonrpc: '2.0',
      id,
      error: { code, message: 'secret server text', data },
    },
    status,
  );
const ok = (
  id: number,
  result: unknown,
  headers: Record<string, string> = {},
) => json({ jsonrpc: '2.0', id, result }, 200, headers);

type Handler = (req: Seen, n: number) => Response | Promise<Response>;

/** Scripted server: `handler` sees each request in order, `seen` records them. */
function script(handler: Handler) {
  const seen: Seen[] = [];
  const request: McpRequest = async (_url, init, read) => {
    const entry: Seen = {
      method: String(init.method),
      headers: new Headers(init.headers),
      body: init.body
        ? (JSON.parse(init.body as string) as Record<string, any>)
        : undefined,
    };
    seen.push(entry);
    return read(await handler(entry, seen.length));
  };
  return { request, seen };
}

const modernServer: Handler = (req) => {
  const { id, method } = req.body!;
  if (method === 'server/discover')
    return ok(id, {
      supportedVersions: ['2026-07-28'],
      _meta: {
        'io.modelcontextprotocol/serverInfo': { name: 'Modern', version: '9' },
      },
    });
  if (method === 'tools/list') return ok(id, { tools: [{ name: 'a' }] });
  if (method === 'tools/call')
    return ok(id, { content: [{ type: 'text', text: 'hi' }] });
  return new Response('?', { status: 400 });
};

const legacyServer =
  (extra?: Handler): Handler =>
  (req, n) => {
    if (req.method === 'DELETE') return new Response(null, { status: 204 });
    const { id, method } = req.body ?? {};
    if (method === 'server/discover') return json({ error: 'nope' }, 404);
    if (method === 'initialize')
      return ok(
        id,
        {
          protocolVersion: '2025-06-18',
          serverInfo: { name: 'Legacy', version: '1' },
        },
        { 'mcp-session-id': 'sess-1' },
      );
    if (method === 'notifications/initialized')
      return new Response(null, { status: 202 });
    if (method === 'tools/list') return ok(id, { tools: [{ name: 'b' }] });
    if (method === 'tools/call') return ok(id, { content: [] });
    return extra ? extra(req, n) : new Response('?', { status: 400 });
  };

const connect = (request: McpRequest, over: Partial<McpClientOptions> = {}) =>
  McpHttpClient.connect({
    endpoint: 'https://mcp.example.com/mcp',
    request,
    headers: { Authorization: 'Bearer tok-123' },
    deadline: Date.now() + 5_000,
    maxResponseBytes: 64 * 1024,
    maxListPages: 10,
    clientName: 'supercheck-monitor',
    mode: 'auto',
    ...over,
  });

const methods = (seen: Seen[]) => seen.map((s) => s.body?.method ?? s.method);
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as McpError;
  }
  throw new Error('expected a failure');
};

describe('McpHttpClient stateless (2026) path', () => {
  it('auto mode discovers, sends the modern headers and _meta, and never opens a session', async () => {
    const { request, seen } = script(modernServer);
    const client = await connect(request);
    expect(client.protocol).toBe('2026');
    expect(client.protocolVersion).toBe('2026-07-28');
    expect(client.serverName).toBe('Modern');
    expect(client.serverVersion).toBe('9');
    const { tools } = await client.listTools();
    expect(tools).toEqual([{ name: 'a' }]);
    await client.callTool('a', { x: 1 });
    await client.close();

    expect(methods(seen)).toEqual([
      'server/discover',
      'tools/list',
      'tools/call',
    ]);
    for (const entry of seen) {
      expect(entry.headers.get('mcp-protocol-version')).toBe('2026-07-28');
      expect(entry.headers.get('mcp-method')).toBe(entry.body!.method);
      expect(entry.headers.get('mcp-session-id')).toBeNull();
      expect(entry.headers.get('authorization')).toBe('Bearer tok-123');
      expect(entry.body!.params._meta).toEqual({
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': {
          name: 'supercheck-monitor',
          version: '1',
        },
        'io.modelcontextprotocol/clientCapabilities': {},
      });
    }
    expect(seen[2].headers.get('mcp-name')).toBe('a');
    expect(seen[1].headers.get('mcp-name')).toBeNull();
    expect(seen[2].body!.params.arguments).toEqual({ x: 1 });
    expect(client.timings.connectMs).toBeGreaterThanOrEqual(0);
    expect(client.timings.listMs).toBeGreaterThanOrEqual(0);
    expect(client.timings.callMs).toBeGreaterThanOrEqual(0);
  });

  it('reads serverInfo from the result when _meta has none, and ignores a malformed one', async () => {
    const { request } = script((req) =>
      ok(req.body!.id, {
        supportedVersions: ['2026-07-28'],
        serverInfo: { name: 'N'.repeat(300), version: 4 },
      }),
    );
    const client = await connect(request);
    expect(client.serverName).toHaveLength(128);
    expect(client.serverVersion).toBeUndefined();
  });

  it('treats an input_required tool result as a failed call', async () => {
    const { request } = script((req) =>
      req.body!.method === 'tools/call'
        ? ok(req.body!.id, { resultType: 'input_required' })
        : modernServer(req, 1),
    );
    const client = await connect(request);
    expect((await failure(client.callTool('a', {}))).code).toBe(
      'mcp_input_required',
    );
  });

  it('refuses tool names outside the plain character set', async () => {
    const { request } = script(modernServer);
    const client = await connect(request);
    expect((await failure(client.callTool('bad name\n', {}))).code).toBe(
      'mcp_invalid_tool_name',
    );
  });

  it('forced 2026 discovers and fails when discover fails', async () => {
    const good = script(modernServer);
    const client = await connect(good.request, { mode: '2026' });
    expect(client.protocol).toBe('2026');
    const bad = script(() => json({ error: 1 }, 404));
    const err = await failure(connect(bad.request, { mode: '2026' }));
    expect(err.code).toBe('mcp_http_404');
    expect(bad.seen).toHaveLength(1);
  });
});

describe('McpHttpClient 2025 handshake path and auto fallback', () => {
  it('falls back to initialize after a 404 on discover, carries the session id and deletes it', async () => {
    const { request, seen } = script(legacyServer());
    const client = await connect(request);
    expect(client.protocol).toBe('2025');
    expect(client.serverName).toBe('Legacy');
    await client.listTools();
    await client.close();
    expect(methods(seen)).toEqual([
      'server/discover',
      'initialize',
      'notifications/initialized',
      'tools/list',
      'DELETE',
    ]);
    expect(seen[1].headers.get('mcp-session-id')).toBeNull();
    expect(seen[1].headers.get('mcp-protocol-version')).toBeNull();
    expect(seen[1].body!.params.clientInfo.name).toBe('supercheck-monitor');
    expect(seen[3].headers.get('mcp-session-id')).toBe('sess-1');
    expect(seen[3].headers.get('mcp-protocol-version')).toBe('2025-06-18');
    expect(seen[3].body!.params).toBeUndefined();
    expect(seen[4].headers.get('mcp-session-id')).toBe('sess-1');
  });

  it.each([
    ['method not found', () => rpcError(1, -32601)],
    ['a 400 that is not JSON', () => new Response('bad', { status: 400 })],
    ['a 500', () => new Response('no', { status: 500 })],
    [
      'a non-MCP 200',
      () =>
        new Response('<html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    ],
    [
      'a JSON-RPC reply for another id',
      () => json({ jsonrpc: '2.0', id: 99, result: {} }),
    ],
    ['an empty result', () => json({ jsonrpc: '2.0', id: 1, result: 5 })],
    [
      'broken JSON',
      () =>
        new Response('{', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ],
    [
      'an SSE stream with no reply',
      () =>
        new Response('data: nope\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    ],
  ])('falls back to the handshake on %s', async (_name, probeReply) => {
    const { request, seen } = script((req, n) =>
      n === 1 ? probeReply() : legacyServer()(req, n),
    );
    const client = await connect(request);
    expect(client.protocol).toBe('2025');
    expect(methods(seen).slice(0, 3)).toEqual([
      'server/discover',
      'initialize',
      'notifications/initialized',
    ]);
  });

  it('falls back to the handshake when the probe times out', async () => {
    const { request, seen } = script((req, n) => {
      if (n === 1)
        throw Object.assign(new Error('t'), { name: 'TimeoutError' });
      return legacyServer()(req, n);
    });
    expect((await connect(request)).protocol).toBe('2025');
    expect(methods(seen)).toContain('initialize');
  });

  it('does not retry the handshake when the probe cannot reach the host', async () => {
    const { request, seen } = script(() => {
      throw new Error('connect ECONNREFUSED');
    });
    const err = await failure(connect(request));
    expect(err.code).toBe('mcp_request_failed');
    expect(err.network).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('stops on 401 and 403 during the probe', async () => {
    for (const status of [401, 403]) {
      const { request, seen } = script(() => new Response('no', { status }));
      const err = await failure(connect(request));
      expect(err.code).toBe('mcp_credentials_rejected');
      expect(err.httpStatus).toBe(status);
      expect(seen).toHaveLength(1);
    }
  });

  it('stops on an oversized probe reply', async () => {
    const { request } = script(
      () =>
        new Response('x'.repeat(100), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    expect(
      (await failure(connect(request, { maxResponseBytes: 10 }))).code,
    ).toBe('mcp_response_too_large');
  });

  it('does not fall back to initialize on -32022: it picks the modern version from data.supported', async () => {
    const { request, seen } = script((req) =>
      req.body!.method === 'tools/list'
        ? ok(req.body!.id, { tools: [] })
        : rpcError(
            req.body!.id,
            -32022,
            { supported: ['2025-06-18', '2026-07-28'] },
            400,
          ),
    );
    const client = await connect(request);
    expect(client.protocol).toBe('2026');
    await client.listTools();
    expect(methods(seen)).toEqual(['server/discover', 'tools/list']);
  });

  it('uses the handshake when -32022 lists only a 2025 version', async () => {
    const { request, seen } = script((req, n) =>
      n === 1
        ? rpcError(1, -32022, { supported: ['2025-03-26'] }, 400)
        : legacyServer()(req, n),
    );
    expect((await connect(request)).protocol).toBe('2025');
    expect(methods(seen)).toContain('initialize');
  });

  it.each([[{ supported: ['2024-11-05'] }], [undefined], ['junk']])(
    'fails the connection on -32022 with no usable version (%j)',
    async (data) => {
      const { request, seen } = script(() => rpcError(1, -32022, data, 400));
      expect((await failure(connect(request))).code).toBe(
        'mcp_unsupported_version',
      );
      expect(seen).toHaveLength(1);
    },
  );

  it('uses the handshake when discover answers with versions that exclude the modern one', async () => {
    const { request } = script((req, n) =>
      n === 1
        ? ok(1, { supportedVersions: ['2025-06-18'] })
        : legacyServer()(req, n),
    );
    expect((await connect(request)).protocol).toBe('2025');
  });

  it('accepts a discover result that lists no versions as modern', async () => {
    const { request } = script((req) => ok(req.body!.id, {}));
    expect((await connect(request)).protocol).toBe('2026');
  });

  it('forced 2025 never probes, and falls back to the default version for a bad protocolVersion', async () => {
    const { request, seen } = script((req, n) =>
      req.body?.method === 'initialize'
        ? ok(
            req.body.id,
            { protocolVersion: 'evil\nvalue' },
            { 'mcp-session-id': 'bad id with spaces' },
          )
        : legacyServer()(req, n),
    );
    const client = await connect(request, { mode: '2025' });
    expect(methods(seen)).toEqual(['initialize', 'notifications/initialized']);
    expect(client.protocolVersion).toBe('2025-06-18');
    await client.close(); // the malformed session id was ignored, so there is nothing to delete
    expect(seen).toHaveLength(2);
  });

  it('closes the session when the handshake fails after it was created', async () => {
    const { request, seen } = script((req, n) =>
      req.body?.method === 'notifications/initialized'
        ? new Response('no', { status: 500 })
        : legacyServer()(req, n),
    );
    const err = await failure(connect(request, { mode: '2025' }));
    expect(err.code).toBe('mcp_http_500');
    expect(seen[seen.length - 1].method).toBe('DELETE');
  });
});

describe('McpHttpClient remembered mode', () => {
  it('reuses a remembered 2026 mode with a single discover (no detection probe)', async () => {
    const { request, seen } = script(modernServer);
    const client = await connect(request, { remembered: '2026' });
    await client.listTools();
    expect(methods(seen)).toEqual(['server/discover', 'tools/list']);
    expect(client.protocol).toBe('2026');
  });

  it('reuses a remembered 2025 mode with the handshake only', async () => {
    const { request, seen } = script(legacyServer());
    const client = await connect(request, { remembered: '2025' });
    expect(client.protocol).toBe('2025');
    expect(methods(seen)).toEqual(['initialize', 'notifications/initialized']);
  });

  it('re-detects once when a remembered 2026 mode fails with a version error, then succeeds on the handshake', async () => {
    const { request, seen } = script((req, n) => {
      if (n === 1)
        return rpcError(
          req.body!.id,
          -32022,
          { supported: ['2025-06-18'] },
          400,
        );
      return legacyServer()(req, n);
    });
    const client = await connect(request, { remembered: '2026' });
    const { tools } = await client.listTools();
    expect(tools).toEqual([{ name: 'b' }]);
    expect(client.protocol).toBe('2025');
    expect(methods(seen).filter((m) => m === 'tools/list')).toHaveLength(1);
    expect(methods(seen)).toContain('initialize');
  });

  it('re-detects once when a remembered 2025 server rejects tools/list with method-not-found', async () => {
    const { request, seen } = script((req, n) =>
      req.body?.method === 'tools/list' && n <= 4
        ? rpcError(req.body.id, -32601, undefined, 400)
        : req.body?.method === 'initialize' && n > 4
          ? rpcError(req.body.id, -32601, undefined, 400)
          : n > 4
            ? modernServer(req, n)
            : legacyServer()(req, n),
    );
    const client = await connect(request, { remembered: '2025' });
    const { tools } = await client.listTools();
    expect(client.protocol).toBe('2026');
    expect(tools).toEqual([{ name: 'a' }]);
    expect(methods(seen).filter((m) => m === 'tools/list')).toHaveLength(2);
  });

  it('re-detects once when a remembered 2025 handshake fails with a version error', async () => {
    const { request, seen } = script((req, n) => {
      if (n === 1) return new Response('bad', { status: 400 });
      return modernServer(req, n);
    });
    const client = await connect(request, { remembered: '2025' });
    expect(client.protocol).toBe('2026');
    expect(methods(seen)).toEqual(['initialize', 'server/discover']);
  });

  it('does not re-detect twice', async () => {
    const { request, seen } = script((req) =>
      rpcError(req.body!.id, -32601, undefined, 400),
    );
    const err = await failure(connect(request, { remembered: '2026' }));
    expect(isVersionError(err)).toBe(true);
    // remembered discover, one detection probe, the handshake that fails the whole detection
    expect(methods(seen)).toEqual([
      'server/discover',
      'server/discover',
      'initialize',
    ]);
  });

  it('does not re-detect for errors that are not version errors', async () => {
    const { request, seen } = script(() => new Response('no', { status: 500 }));
    expect((await failure(connect(request, { remembered: '2026' }))).code).toBe(
      'mcp_http_500',
    );
    expect(seen).toHaveLength(1);
  });

  it('propagates a non-version handshake failure for a remembered 2025 mode', async () => {
    const { request } = script(() => new Response('no', { status: 500 }));
    expect((await failure(connect(request, { remembered: '2025' }))).code).toBe(
      'mcp_http_500',
    );
  });

  it('does not re-detect when the mode is forced', async () => {
    const { request, seen } = script(
      () => new Response('bad', { status: 400 }),
    );
    const err = await failure(
      connect(request, { mode: '2025', remembered: '2026' }),
    );
    expect(err.code).toBe('mcp_http_400');
    expect(seen).toHaveLength(1);
  });
});

describe('McpHttpClient review fixes', () => {
  it('a remembered 2026 mode still discovers once, so server info is always present', async () => {
    const { request, seen } = script(modernServer);
    const client = await connect(request, { remembered: '2026' });
    expect(methods(seen)).toEqual(['server/discover']);
    expect(client.serverName).toBe('Modern');
    expect(client.serverVersion).toBe('9');
  });

  it('does not keep a session id from a non-2xx reply', async () => {
    const { request, seen } = script((req, n) =>
      n === 1
        ? new Response('no', {
            status: 500,
            headers: { 'mcp-session-id': 'from-error' },
          })
        : legacyServer()(req, n),
    );
    const client = await connect(request, { mode: '2025' }).catch(() => null);
    expect(client).toBeNull();
    expect(
      seen.some((s) => s.headers.get('mcp-session-id') === 'from-error'),
    ).toBe(false);
    expect(seen.some((s) => s.method === 'DELETE')).toBe(false);
  });

  it('clears the session id before the handshake that follows a failed probe', async () => {
    const { request, seen } = script((req, n) =>
      n === 1
        ? new Response('<html>', {
            status: 200,
            headers: {
              'content-type': 'text/html',
              'mcp-session-id': 'probe-session',
            },
          })
        : legacyServer()(req, n),
    );
    const client = await connect(request);
    expect(client.protocol).toBe('2025');
    const init = seen.find((s) => s.body?.method === 'initialize')!;
    expect(init.headers.get('mcp-session-id')).toBeNull();
    await client.listTools();
    expect(
      seen
        .find((s) => s.body?.method === 'tools/list')!
        .headers.get('mcp-session-id'),
    ).toBe('sess-1');
  });

  it('never resends tools/call: a 400 on a remembered 2025 call fails once', async () => {
    const { request, seen } = script((req, n) =>
      req.body?.method === 'tools/call'
        ? new Response('bad args', { status: 400 })
        : legacyServer()(req, n),
    );
    const client = await connect(request, { remembered: '2025' });
    const err = await failure(client.callTool('t', {}));
    expect(err.code).toBe('mcp_http_400');
    expect(seen.filter((s) => s.body?.method === 'tools/call')).toHaveLength(1);
  });

  it('never resends tools/call even on -32601 or -32022', async () => {
    for (const code of [-32601, -32022]) {
      const { request, seen } = script((req, n) =>
        req.body?.method === 'tools/call'
          ? rpcError(req.body.id, code, { supported: ['2026-07-28'] }, 400)
          : modernServer(req, n),
      );
      const client = await connect(request, { remembered: '2026' });
      await failure(client.callTool('t', {}));
      expect(seen.filter((s) => s.body?.method === 'tools/call')).toHaveLength(
        1,
      );
    }
  });

  it('a bare 400 on tools/list does not trigger re-detection', async () => {
    const { request, seen } = script((req, n) =>
      req.body?.method === 'tools/list'
        ? new Response('bad', { status: 400 })
        : legacyServer()(req, n),
    );
    const client = await connect(request, { remembered: '2025' });
    expect((await failure(client.listTools())).code).toBe('mcp_http_400');
    expect(seen.filter((s) => s.body?.method === 'tools/list')).toHaveLength(1);
  });

  it('forced 2025 keeps plain HTTP status codes even when the body is a JSON-RPC error', async () => {
    const { request } = script(() => rpcError(1, -32000, undefined, 500));
    expect((await failure(connect(request, { mode: '2025' }))).code).toBe(
      'mcp_http_500',
    );
  });
});

describe('McpHttpClient replies, pagination and caps', () => {
  const sse = (...events: string[]) =>
    new Response(events.join(''), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });

  it('reads an SSE reply, skipping server-initiated requests and notifications without answering', async () => {
    const { request, seen } = script((req) => {
      const id = req.body!.id;
      if (req.body!.method === 'server/discover')
        return sse(
          'event: message\ndata: {"jsonrpc":"2.0","id":"s1","method":"sampling/createMessage","params":{}}\n\n',
          'data: not json\n\n',
          ': comment\n\n',
          `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: { supportedVersions: ['2026-07-28'] } })}\n\n`,
        );
      return modernServer(req, 1);
    });
    const client = await connect(request);
    expect(client.protocol).toBe('2026');
    expect(seen).toHaveLength(1); // nothing was sent back for the sampling request
  });

  it('reads a JSON reply split across several data lines', async () => {
    const { request } = script((req) =>
      sse(
        `data: {"jsonrpc":"2.0","id":${req.body!.id},\ndata: "result":{"supportedVersions":["2026-07-28"]}}\n\n`,
      ),
    );
    expect((await connect(request)).protocol).toBe('2026');
  });

  it('follows nextCursor across pages', async () => {
    const { request, seen } = script((req) => {
      if (req.body!.method === 'server/discover') return modernServer(req, 1);
      const cursor = req.body!.params.cursor as string | undefined;
      if (!cursor)
        return ok(req.body!.id, { tools: [{ name: 'a' }], nextCursor: 'p2' });
      if (cursor === 'p2')
        return ok(req.body!.id, { tools: [{ name: 'b' }], nextCursor: 'p3' });
      return ok(req.body!.id, { tools: [{ name: 'c' }] });
    });
    const client = await connect(request);
    const { tools, hasMore } = await client.listTools();
    expect(tools).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    expect(hasMore).toBe(false);
    expect(seen.filter((s) => s.body!.method === 'tools/list')).toHaveLength(3);
  });

  it('stops at the page cap (10 for the monitor) and reports more pages', async () => {
    const { request, seen } = script((req) =>
      req.body!.method === 'server/discover'
        ? modernServer(req, 1)
        : ok(req.body!.id, { tools: [{ name: 'a' }], nextCursor: 'more' }),
    );
    const client = await connect(request, { maxListPages: 10 });
    const { tools, hasMore } = await client.listTools();
    expect(seen.filter((s) => s.body!.method === 'tools/list')).toHaveLength(
      10,
    );
    expect(tools).toHaveLength(10);
    expect(hasMore).toBe(true);
  });

  it('stops after reaching the tool cap and a lower page cap for the private agent', async () => {
    const { request, seen } = script((req) =>
      req.body!.method === 'server/discover'
        ? modernServer(req, 1)
        : ok(req.body!.id, {
            tools: [{ name: 'a' }, { name: 'b' }],
            nextCursor: 'more',
          }),
    );
    const client = await connect(request, { maxListPages: 5 });
    await client.listTools(3);
    expect(seen.filter((s) => s.body!.method === 'tools/list')).toHaveLength(2);
  });

  it('ignores a non-array tools field and a non-string cursor', async () => {
    const { request } = script((req) =>
      req.body!.method === 'server/discover'
        ? modernServer(req, 1)
        : ok(req.body!.id, { tools: 'x', nextCursor: 5 }),
    );
    const client = await connect(request);
    expect(await client.listTools()).toEqual({ tools: [], hasMore: false });
  });

  it('rejects a reply over the cap, JSON or SSE, and one without a body', async () => {
    for (const make of [
      () =>
        new Response('x'.repeat(2_000), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      () => sse(`data: ${'x'.repeat(2_000)}\n\n`),
    ]) {
      const { request } = script((req) =>
        req.body!.method === 'server/discover' ? modernServer(req, 1) : make(),
      );
      const client = await connect(request, { maxResponseBytes: 1_000 });
      expect((await failure(client.listTools())).code).toBe(
        'mcp_response_too_large',
      );
    }
  });

  it('maps JSON-RPC errors on tools/list to their code and never copies the server text', async () => {
    const { request } = script((req) =>
      req.body!.method === 'server/discover'
        ? modernServer(req, 1)
        : rpcError(req.body!.id, -32000),
    );
    const client = await connect(request);
    const err = await failure(client.listTools());
    expect(err.code).toBe('mcp_rpc_error_-32000');
    expect(err.rpcCode).toBe(-32000);
    expect(err.message).not.toContain('secret server text');
  });

  it('reports a code of 0 for an error object without a numeric code', async () => {
    const { request } = script((req) =>
      req.body!.method === 'server/discover'
        ? modernServer(req, 1)
        : json({ jsonrpc: '2.0', id: req.body!.id, error: { message: 'x' } }),
    );
    expect((await failure((await connect(request)).listTools())).code).toBe(
      'mcp_rpc_error_0',
    );
  });

  it('keeps the plain HTTP error when a 400 body is not a JSON-RPC reply', async () => {
    const { request } = script((req) =>
      req.body!.method === 'server/discover'
        ? modernServer(req, 1)
        : json({ unrelated: true }, 400),
    );
    expect((await failure((await connect(request)).listTools())).code).toBe(
      'mcp_http_400',
    );
  });

  it('keeps the plain HTTP error for an unparsable JSON 400', async () => {
    const { request } = script((req) =>
      req.body!.method === 'server/discover'
        ? modernServer(req, 1)
        : new Response('{', {
            status: 400,
            headers: { 'content-type': 'application/json' },
          }),
    );
    expect((await failure((await connect(request)).listTools())).code).toBe(
      'mcp_http_400',
    );
  });

  it('treats a reply with no body as a protocol error', async () => {
    const { request } = script((req) =>
      req.body!.method === 'server/discover'
        ? modernServer(req, 1)
        : new Response(null, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
    );
    expect((await failure((await connect(request)).listTools())).code).toBe(
      'mcp_protocol_error',
    );
  });
});

describe('McpHttpClient deadline and transport errors', () => {
  it('fails with a timeout when the deadline has passed, without sending anything', async () => {
    const { request, seen } = script(modernServer);
    const err = await failure(
      connect(request, { deadline: Date.now() - 1, mode: '2026' }),
    );
    expect(err.code).toBe('mcp_timeout');
    expect(seen).toHaveLength(0);
  });

  it('maps an aborted request to a timeout', async () => {
    const { request } = script(() => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    expect((await failure(connect(request, { mode: '2025' }))).code).toBe(
      'mcp_timeout',
    );
  });

  it('gives every request a signal that aborts at the deadline', async () => {
    let aborted: Promise<boolean> | undefined;
    const request: McpRequest = (_url, init, read) => {
      aborted = new Promise((resolve) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener('abort', () => resolve(true));
      });
      return read(ok(1, { supportedVersions: ['2026-07-28'] }));
    };
    await connect(request, { deadline: Date.now() + 50 });
    expect(await aborted).toBe(true);
  });

  it('keeps fixed policy messages from the transport and drops everything else', async () => {
    const policy = new Error(
      'Access to private or reserved networks is not allowed?token=abc',
    );
    const err = await failure(
      connect(
        script(() => {
          throw policy;
        }).request,
        {
          safeMessage: (e) => (e === policy ? 'refused' : undefined),
          mode: '2025',
        },
      ),
    );
    expect(err.code).toBe('refused');
    expect(err.cause).toBe(policy);
    const other = await failure(
      connect(
        script(() => {
          throw new Error('Authorization: Bearer tok-123 leaked');
        }).request,
        { safeMessage: () => undefined, mode: '2025' },
      ),
    );
    expect(other.code).toBe('mcp_request_failed');
    expect(other.message).not.toContain('tok-123');
  });

  it('wraps a non-Error throw as a request failure', async () => {
    const request: McpRequest = () =>
      Promise.reject(Object.create(null) as Error);
    expect((await failure(connect(request, { mode: '2025' }))).code).toBe(
      'mcp_request_failed',
    );
  });

  it('close() swallows a failing DELETE', async () => {
    const { request } = script((req, n) =>
      req.method === 'DELETE'
        ? new Response(null, { status: 500 })
        : legacyServer()(req, n),
    );
    const client = await connect(request, { mode: '2025' });
    await expect(client.close()).resolves.toBeUndefined();
    const throwing: McpRequest = () => Promise.reject(new Error('x'));
    const c2 = await connect(script(legacyServer()).request, { mode: '2025' });
    (c2 as unknown as { o: { request: McpRequest } }).o.request = throwing;
    await expect(c2.close()).resolves.toBeUndefined();
  });
});
