import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchWithRetry } from './retry.util';

/** Real sockets: only a real HTTP exchange shows whether a redirect is followed. */
describe('fetchWithRetry redirects', () => {
  let origin: Server;
  let internal: Server;
  let internalHits = 0;
  let originPort: number;
  let internalPort: number;

  beforeAll(async () => {
    internal = createServer((_req, res) => {
      internalHits += 1;
      res.writeHead(200).end('internal');
    });
    await new Promise<void>((resolve) =>
      internal.listen(0, '127.0.0.1', resolve),
    );
    internalPort = (internal.address() as AddressInfo).port;
    origin = createServer((_req, res) => {
      res
        .writeHead(307, { location: `http://127.0.0.1:${internalPort}/secret` })
        .end();
    });
    await new Promise<void>((resolve) =>
      origin.listen(0, '127.0.0.1', resolve),
    );
    originPort = (origin.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => origin.close(() => resolve()));
    await new Promise<void>((resolve) => internal.close(() => resolve()));
  });

  it('does not follow a redirect to another host', async () => {
    const result = await fetchWithRetry(
      `http://127.0.0.1:${originPort}/hook`,
      { method: 'POST', body: '{}' },
      { maxRetries: 0, timeoutMs: 2000, initialDelayMs: 1, maxDelayMs: 1 },
    );

    expect(result.success).toBe(false);
    expect(internalHits).toBe(0);
  });
});
