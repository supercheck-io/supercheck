jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { lookup } from 'node:dns/promises';
import {
  MCP_REDIRECT_MESSAGE,
  McpPolicyError,
  createMcpMonitorRequest,
} from './mcp-monitor-transport';

const lookupMock = lookup as unknown as jest.Mock;
const readText = (r: Response) => r.text();

describe('createMcpMonitorRequest (monitor policy)', () => {
  let server: Server;
  let other: Server;
  let port: number;
  let otherHits: number;
  let hostHeaders: (string | undefined)[];
  let authHeaders: (string | undefined)[];

  beforeAll(async () => {
    other = createServer((_req, res) => {
      otherHits += 1;
      res.end('other');
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const otherPort = (other.address() as AddressInfo).port;
    server = createServer((req, res) => {
      hostHeaders.push(req.headers.host);
      authHeaders.push(req.headers.authorization);
      if (req.url === '/redirect') {
        res.writeHead(302, { location: `http://127.0.0.1:${otherPort}/` });
        return res.end();
      }
      if (req.url === '/big') return res.end('x'.repeat(5 * 1024 * 1024));
      res.end('ok');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await new Promise((r) => other.close(r));
  });
  beforeEach(() => {
    otherHits = 0;
    hostHeaders = [];
    authHeaders = [];
    lookupMock.mockReset();
    delete process.env.ALLOW_INTERNAL_TARGETS;
  });
  afterEach(() => delete process.env.ALLOW_INTERNAL_TARGETS);

  const call = (url: string, init: RequestInit = {}) =>
    createMcpMonitorRequest()(url, init, readText);

  it.each([
    ['a private IPv4 literal', 'https://10.0.0.5/mcp'],
    ['loopback', 'https://127.0.0.1/mcp'],
    ['link-local', 'https://169.254.1.1/mcp'],
    ['the cloud metadata address', 'https://169.254.169.254/latest'],
    ['an IPv6 loopback', 'https://[::1]/mcp'],
    ['IPv6 link-local', 'https://[fe80::1]/mcp'],
    ['the AWS IPv6 metadata address', 'https://[fd00:ec2::254]/mcp'],
  ])('refuses %s', async (_name, url) => {
    await expect(call(url)).rejects.toThrow(/private or reserved/);
  });

  it('refuses a hostname that resolves to a private address, even if one answer is public', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ]);
    await expect(call('https://mcp.example.test/mcp')).rejects.toThrow(
      /private or reserved/,
    );
  });

  it('refuses a hostname that resolves to a metadata address even with internal targets allowed', async () => {
    process.env.ALLOW_INTERNAL_TARGETS = 'true';
    lookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(call('https://mcp.example.test/mcp')).rejects.toThrow(
      /private or reserved/,
    );
    await expect(call('https://169.254.169.254/mcp')).rejects.toThrow(
      /private or reserved/,
    );
  });

  it('refuses URL credentials', async () => {
    await expect(call('https://user:pw@mcp.example.test/mcp')).rejects.toThrow(
      new McpPolicyError('MCP URLs cannot include credentials'),
    );
    await expect(
      call('https://user@mcp.example.test/mcp'),
    ).rejects.toBeInstanceOf(McpPolicyError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('refuses plain http and other schemes unless internal targets are allowed', async () => {
    await expect(call(`http://127.0.0.1:${port}/mcp`)).rejects.toThrow(
      'MCP URL must use https',
    );
    await expect(call('http://mcp.example.test/mcp')).rejects.toBeInstanceOf(
      McpPolicyError,
    );
    await expect(call('ftp://mcp.example.test/mcp')).rejects.toBeInstanceOf(
      McpPolicyError,
    );
    expect(hostHeaders).toHaveLength(0);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('allows an internal http target only with ALLOW_INTERNAL_TARGETS=true', async () => {
    process.env.ALLOW_INTERNAL_TARGETS = 'true';
    await expect(call(`http://127.0.0.1:${port}/mcp`)).resolves.toBe('ok');
    process.env.ALLOW_INTERNAL_TARGETS = '1';
    await expect(call(`http://127.0.0.1:${port}/mcp`)).rejects.toBeInstanceOf(
      McpPolicyError,
    );
  });

  it('does not follow a redirect and never sends the token to the redirect target', async () => {
    process.env.ALLOW_INTERNAL_TARGETS = 'true';
    const err = await call(`http://127.0.0.1:${port}/redirect`, {
      headers: { Authorization: 'Bearer tok-123' },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpPolicyError);
    expect((err as Error).message).toBe(MCP_REDIRECT_MESSAGE);
    expect(otherHits).toBe(0);
    expect(authHeaders).toEqual(['Bearer tok-123']);
  });

  it('rethrows other network errors untouched', async () => {
    process.env.ALLOW_INTERNAL_TARGETS = 'true';
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise((r) => closed.close(r));
    const err = await call(`http://127.0.0.1:${closedPort}/`).catch(
      (e: unknown) => e,
    );
    expect((err as Error).name).toBe('TypeError');
    expect(err).not.toBeInstanceOf(McpPolicyError);
  });

  it('resolves once per check and connects to the vetted address with the hostname kept in Host', async () => {
    process.env.ALLOW_INTERNAL_TARGETS = 'true';
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const request = createMcpMonitorRequest();
    await request(`http://mcp.example.test:${port}/a`, {}, readText);
    // A rebinding answer after the first resolution is never consulted.
    lookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await request(`http://mcp.example.test:${port}/b`, {}, readText);
    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(hostHeaders).toEqual([
      `mcp.example.test:${port}`,
      `mcp.example.test:${port}`,
    ]);
  });

  it('resolves again for a different host', async () => {
    process.env.ALLOW_INTERNAL_TARGETS = 'true';
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const request = createMcpMonitorRequest();
    await request(`http://one.example.test:${port}/`, {}, readText);
    await request(`http://two.example.test:${port}/`, {}, readText);
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it('fails a hostname that does not resolve', async () => {
    lookupMock.mockResolvedValue([]);
    await expect(call('https://nowhere.example.test/')).rejects.toMatchObject({
      code: 'ENOTFOUND',
    });
  });

  it('caps the body so a hostile reply cannot exhaust memory', async () => {
    process.env.ALLOW_INTERNAL_TARGETS = 'true';
    await expect(call(`http://127.0.0.1:${port}/big`)).rejects.toThrow(
      /exceeded/,
    );
  });

  it('lets an aborted signal end a slow resolver, and a pre-aborted one fail at once', async () => {
    lookupMock.mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    const pending = call('https://slow.example.test/', {
      signal: controller.signal,
    });
    controller.abort(new Error('deadline'));
    await expect(pending).rejects.toThrow('deadline');
    await expect(
      call('https://slow2.example.test/', { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const bare = new AbortController();
    const plain = call('https://slow3.example.test/', { signal: bare.signal });
    bare.abort('not an error');
    await expect(plain).rejects.toMatchObject({ name: 'AbortError' });
  });
});
