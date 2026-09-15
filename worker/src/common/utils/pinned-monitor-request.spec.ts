import { lookup } from 'node:dns/promises';
import { createServer } from 'node:http';
import { AxiosHeaders, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import axios from 'axios';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

import { requestPinnedMonitorTarget } from './pinned-monitor-request';

const mockLookup = lookup as jest.MockedFunction<typeof lookup>;

function response(
  status = 200,
  headers: Record<string, string> = {},
): AxiosResponse {
  return {
    status,
    statusText: String(status),
    headers,
    config: { headers: new AxiosHeaders() },
    data: 'ok',
  };
}

describe('pinned HTTP monitor requests', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['http://[::ffff:ac12:5]/', 'http://[::ffff:172.18.0.5]/'])(
    'rejects private IPv4-mapped IPv6 literal %s',
    async (url) => {
      const execute = jest.fn();
      await expect(
        requestPinnedMonitorTarget(
          { url },
          { allowInternalTargets: false, maxRedirects: 5 },
          execute,
        ),
      ).rejects.toThrow('private or reserved');
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('rejects a hostname when any DNS answer is private', async () => {
    (mockLookup as jest.Mock).mockResolvedValueOnce([
      { address: '203.0.114.10', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    const execute = jest.fn();

    await expect(
      requestPinnedMonitorTarget(
        { url: 'https://monitor.example/' },
        { allowInternalTargets: false, maxRedirects: 5 },
        execute,
      ),
    ).rejects.toThrow('private or reserved');
    expect(execute).not.toHaveBeenCalled();
  });

  it('pins a public request and disables automatic redirects and proxies', async () => {
    (mockLookup as jest.Mock).mockResolvedValueOnce([
      { address: '203.0.114.10', family: 4 },
    ]);
    const execute = jest.fn(async (config: AxiosRequestConfig) => {
      expect(config.maxRedirects).toBe(0);
      expect(config.proxy).toBe(false);
      expect(config.httpAgent).toBeDefined();
      expect(config.httpsAgent).toBeDefined();

      const pinnedLookup = (config.httpAgent as {
        options: { lookup: unknown };
      }).options.lookup as (
        hostname: string,
        options: unknown,
        callback: (
          error: NodeJS.ErrnoException | null,
          address: string,
          family: number,
        ) => void,
      ) => void;
      const callback = jest.fn();
      pinnedLookup('monitor.example', { all: true }, callback);
      expect(callback).toHaveBeenCalledWith(null, [
        { address: '203.0.114.10', family: 4 },
      ]);

      const singleAddressCallback = jest.fn();
      pinnedLookup('monitor.example', { all: false }, singleAddressCallback);
      expect(singleAddressCallback).toHaveBeenCalledWith(
        null,
        '203.0.114.10',
        4,
      );

      return response();
    });

    await expect(
      requestPinnedMonitorTarget(
        { url: 'https://monitor.example/' },
        { allowInternalTargets: false, maxRedirects: 5 },
        execute,
      ),
    ).resolves.toMatchObject({ status: 200 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('connects through the pinned agent using Node multi-address lookup', async () => {
    const server = createServer((_request, serverResponse) => {
      serverResponse.end('ok');
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError);
        resolve();
      });
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Test server did not expose a TCP address');
      }

      (mockLookup as jest.Mock).mockResolvedValueOnce([
        { address: '127.0.0.1', family: 4 },
      ]);

      const result = await requestPinnedMonitorTarget(
        { url: `http://monitor.test:${address.port}` },
        { allowInternalTargets: true, maxRedirects: 0 },
        (config) => axios.request(config),
      );

      expect(result.status).toBe(200);
      expect(result.data).toBe('ok');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('revalidates redirect destinations before connecting', async () => {
    (mockLookup as jest.Mock)
      .mockResolvedValueOnce([{ address: '203.0.114.10', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const execute = jest.fn().mockResolvedValueOnce(
      response(302, { location: 'http://internal.example/admin' }),
    );

    await expect(
      requestPinnedMonitorTarget(
        { url: 'https://monitor.example/' },
        { allowInternalTargets: false, maxRedirects: 5 },
        execute,
      ),
    ).rejects.toThrow('private or reserved');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('preserves redirect behavior without forwarding credentials across origins', async () => {
    (mockLookup as jest.Mock)
      .mockResolvedValueOnce([{ address: '203.0.114.10', family: 4 }])
      .mockResolvedValueOnce([{ address: '203.0.114.11', family: 4 }]);
    const execute = jest
      .fn()
      .mockResolvedValueOnce(
        response(302, { location: 'https://other.example/result' }),
      )
      .mockResolvedValueOnce(response());

    await requestPinnedMonitorTarget(
      {
        url: 'https://monitor.example/start',
        method: 'POST',
        data: 'secret body',
        auth: { username: 'monitor', password: 'secret' },
        headers: { Authorization: 'Bearer secret', 'Content-Type': 'text/plain' },
      },
      { allowInternalTargets: false, maxRedirects: 5 },
      execute,
    );

    const redirected = execute.mock.calls[1][0] as AxiosRequestConfig;
    expect(redirected.url).toBe('https://other.example/result');
    expect(redirected.method).toBe('GET');
    expect(redirected.data).toBeUndefined();
    expect(redirected.auth).toBeUndefined();
    expect(
      AxiosHeaders.from(redirected.headers as AxiosHeaders | undefined).get(
        'authorization',
      ),
    ).toBeUndefined();
  });

  it('retains the explicit internal-target opt-in', async () => {
    (mockLookup as jest.Mock).mockResolvedValueOnce([
      { address: '10.0.0.5', family: 4 },
    ]);
    const execute = jest.fn().mockResolvedValueOnce(response());

    await expect(
      requestPinnedMonitorTarget(
        { url: 'http://internal.example/health' },
        { allowInternalTargets: true, maxRedirects: 5 },
        execute,
      ),
    ).resolves.toMatchObject({ status: 200 });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
