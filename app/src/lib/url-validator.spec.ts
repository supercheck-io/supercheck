import { lookup } from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { PassThrough } from 'node:stream';

import {
  fetchSafeExternalUrl,
  resolveWebhookUrlForOutboundRequest,
  validateWebhookUrlString,
} from '@/lib/url-validator';

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

jest.mock('node:http', () => ({
  request: jest.fn(),
}));

jest.mock('node:https', () => ({
  request: jest.fn(),
}));

const lookupMock = jest.mocked(lookup);
const httpRequestMock = jest.mocked(httpRequest);
const httpsRequestMock = jest.mocked(httpsRequest);

function mockNodeRequest(
  requestMock: jest.MockedFunction<typeof httpsRequest>,
  response: { statusCode?: number; statusMessage?: string; body?: string } = {},
) {
  requestMock.mockImplementation((options: any, callback: any) => {
    const req = new EventEmitter() as EventEmitter & {
      write: jest.Mock;
      end: jest.Mock;
    };
    req.write = jest.fn();
    req.end = jest.fn(() => {
      const res = new PassThrough() as PassThrough & {
        statusCode?: number;
        statusMessage?: string;
        headers: Record<string, string>;
      };
      res.statusCode = response.statusCode ?? 200;
      res.statusMessage = response.statusMessage ?? 'OK';
      res.headers = { 'content-type': 'text/plain' };
      callback(res);
      res.end(response.body ?? 'ok');
    });

    (req as any).options = options;
    return req as any;
  });
}

function mockNodeRequestError(
  requestMock: jest.MockedFunction<typeof httpsRequest>,
  error: NodeJS.ErrnoException,
) {
  requestMock.mockImplementationOnce((options: any) => {
    const req = new EventEmitter() as EventEmitter & {
      write: jest.Mock;
      end: jest.Mock;
    };
    req.write = jest.fn();
    req.end = jest.fn(() => {
      req.emit('error', error);
    });

    (req as any).options = options;
    return req as any;
  });
}

describe('url-validator', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = jest.fn() as unknown as typeof global.fetch;
    mockNodeRequest(httpsRequestMock);
    mockNodeRequest(httpRequestMock as unknown as jest.MockedFunction<typeof httpsRequest>);
  });

  it('blocks direct private webhook targets before DNS resolution', async () => {
    expect(validateWebhookUrlString('https://10.0.0.5/hooks/test')).toEqual({
      valid: false,
      error: 'Cannot connect to private or internal networks',
    });

    await expect(
      resolveWebhookUrlForOutboundRequest('https://10.0.0.5/hooks/test'),
    ).rejects.toThrow('Cannot connect to private or internal networks');
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('blocks hex-form IPv4-mapped IPv6 loopback addresses', () => {
    // URL.hostname canonicalizes [::ffff:127.0.0.1] to [::ffff:7f00:1]
    // Both the dotted-quad and hex forms must be detected and rejected
    expect(validateWebhookUrlString('https://[::ffff:127.0.0.1]/hooks/test')).toEqual({
      valid: false,
      error: 'Cannot connect to private or internal networks',
    });

    expect(validateWebhookUrlString('https://[::ffff:7f00:1]/hooks/test')).toEqual({
      valid: false,
      error: 'Cannot connect to private or internal networks',
    });

    // Also block mapped private range addresses (10.x, 192.168.x)
    expect(validateWebhookUrlString('https://[::ffff:a00:1]/hooks/test')).toEqual({
      valid: false,
      error: 'Cannot connect to private or internal networks',
    });

    expect(validateWebhookUrlString('https://[::ffff:c0a8:1]/hooks/test')).toEqual({
      valid: false,
      error: 'Cannot connect to private or internal networks',
    });
  });

  it('blocks IPv4-compatible IPv6 private and loopback addresses', async () => {
    for (const url of [
      'https://[::7f00:1]/hooks/test',
      'https://[::a00:1]/hooks/test',
      'https://[::c0a8:1]/hooks/test',
    ]) {
      expect(validateWebhookUrlString(url)).toEqual({
        valid: false,
        error: 'Cannot connect to private or internal networks',
      });

      await expect(resolveWebhookUrlForOutboundRequest(url)).rejects.toThrow(
        'Cannot connect to private or internal networks',
      );
    }
  });

  it('allows hex-form IPv4-mapped IPv6 with public addresses', () => {
    // 93.184.216.34 = 5db8:d822 in hex
    expect(validateWebhookUrlString('https://[::ffff:5db8:d822]/hooks/test')).toEqual({
      valid: true,
    });
  });

  it('rejects hostnames that resolve to private addresses', async () => {
    lookupMock.mockResolvedValue(
      [{ address: '10.0.0.42', family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>,
    );

    await expect(
      resolveWebhookUrlForOutboundRequest('https://example.com/hooks/test'),
    ).rejects.toThrow('Webhook hostname resolves to a private or reserved IP address');
  });

  it('pins outbound requests to the vetted DNS address', async () => {
    lookupMock.mockResolvedValue(
      [{ address: '93.184.216.34', family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>,
    );

    await expect(
      fetchSafeExternalUrl('https://example.com/hooks/test', {
        method: 'POST',
        body: 'payload',
        headers: { Authorization: 'Bearer token' },
      }),
    ).resolves.toEqual(expect.objectContaining({ status: 200 }));

    expect(httpsRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: '93.184.216.34',
        servername: 'example.com',
        path: '/hooks/test',
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer token',
          host: 'example.com',
          'content-length': '7',
        }),
      }),
      expect.any(Function),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('handles no-content webhook responses without constructing an invalid body', async () => {
    lookupMock.mockResolvedValue(
      [{ address: '93.184.216.34', family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>,
    );
    mockNodeRequest(httpsRequestMock, { statusCode: 204, statusMessage: 'No Content', body: '' });

    await expect(
      fetchSafeExternalUrl('https://example.com/hooks/test', {
        method: 'POST',
        body: 'payload',
      }),
    ).resolves.toEqual(expect.objectContaining({ status: 204 }));
  });

  it('falls back to another vetted DNS address when the first one is unreachable', async () => {
    lookupMock.mockResolvedValue(
      [
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
        { address: '93.184.216.34', family: 4 },
      ] as unknown as Awaited<ReturnType<typeof lookup>>,
    );
    mockNodeRequestError(
      httpsRequestMock,
      Object.assign(new Error('connect ENETUNREACH 2606:2800:220:1:248:1893:25c8:1946'), {
        code: 'ENETUNREACH',
      }),
    );
    mockNodeRequest(httpsRequestMock, { statusCode: 202, statusMessage: 'Accepted' });

    await expect(
      fetchSafeExternalUrl('https://example.com/hooks/test', {
        method: 'POST',
        body: 'payload',
      }),
    ).resolves.toEqual(expect.objectContaining({ status: 202 }));

    expect(httpsRequestMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        hostname: '2606:2800:220:1:248:1893:25c8:1946',
        family: 6,
        servername: 'example.com',
      }),
      expect.any(Function),
    );
    expect(httpsRequestMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        hostname: '93.184.216.34',
        family: 4,
        servername: 'example.com',
      }),
      expect.any(Function),
    );
  });

  it('rejects DNS lookups that exceed the timeout', async () => {
    // Simulate a DNS lookup that never resolves
    lookupMock.mockImplementation(
      () => new Promise(() => {/* never resolves */}) as any,
    );

    await expect(
      resolveWebhookUrlForOutboundRequest('https://slow-dns.example.com/hooks/test'),
    ).rejects.toThrow('Webhook hostname could not be resolved');
  }, 10_000);
});
