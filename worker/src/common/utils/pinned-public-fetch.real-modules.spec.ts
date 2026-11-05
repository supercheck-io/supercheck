import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchPublicEndpoint } from './pinned-public-fetch';

// No module mocks: proves the real node:http/node:https imports resolve under the worker's CommonJS build.
describe('fetchPublicEndpoint with real node modules', () => {
  let server: Server;
  let url: string;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      configurable: true,
      writable: true,
    });
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`${req.method} ${body}`);
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  });

  afterAll(async () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: originalNodeEnv,
      configurable: true,
      writable: true,
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends a request through node:http', async () => {
    const response = await fetchPublicEndpoint(
      url,
      { method: 'POST', body: 'ping' },
      { allowInternal: true },
    );
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('POST ping');
  });

  it('reaches node:https (a TLS failure, not a missing module)', async () => {
    // Errors from node internals come from another realm, so match the message, not the class.
    await expect(
      fetchPublicEndpoint(
        url.replace('http:', 'https:'),
        {},
        { allowInternal: true },
      ),
    ).rejects.not.toThrow(/reading 'request'/);
  });
});
