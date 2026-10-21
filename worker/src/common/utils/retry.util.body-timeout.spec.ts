import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchWithRetry } from './retry.util';

/**
 * Real sockets on purpose: the bug only exists when a server sends headers and then stalls the
 * body, which a mocked fetch cannot reproduce.
 */
describe('fetchWithRetry body timeout', () => {
  let server: Server;
  let port: number;
  const sockets = new Set<import('node:net').Socket>();

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.write('partial'); // headers sent, body never completes
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('gives up on a retryable error whose body never finishes instead of hanging', async () => {
    const started = Date.now();
    const result = await fetchWithRetry(
      `http://127.0.0.1:${port}/`,
      { method: 'POST' },
      { maxRetries: 0, timeoutMs: 400, initialDelayMs: 1, maxDelayMs: 1 },
    );
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.success).toBe(false);
  });
});
