import { lookup } from 'node:dns/promises';
import {
  capResponseBody,
  createAgentPinnedLookup,
  requestPrivateAgentEndpoint,
} from './private-agent-endpoint';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

const mockLookup = lookup as jest.Mock;

describe('Private Agent endpoint transport', () => {
  const originalFetch = global.fetch;

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([
    '127.0.0.2',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '100.100.100.200',
    '168.63.129.16',
    'fd00:ec2::254',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b:1:a9fe:a9fe::',
    '64:ff9b:1::a9fe:a9fe',
    '2002:a9fe:a9fe::',
    '::127.0.0.1',
    '192.0.0.192',
  ])('rejects forbidden resolved address %s before fetch', async (address) => {
    mockLookup.mockResolvedValueOnce([
      { address, family: address.includes(':') ? 6 : 4 },
    ]);
    global.fetch = jest.fn();

    await expect(
      requestPrivateAgentEndpoint('https://internal.example.com', {}, (r) =>
        r.text(),
      ),
    ).rejects.toThrow('cannot target localhost');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects mixed DNS answers and trailing-dot localhost', async () => {
    mockLookup.mockResolvedValueOnce([
      { address: '10.0.0.5', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    global.fetch = jest.fn();

    await expect(
      requestPrivateAgentEndpoint('http://prometheus.internal:9090', {}, (r) =>
        r.text(),
      ),
    ).rejects.toThrow('cannot target localhost');
    await expect(
      requestPrivateAgentEndpoint('http://localhost.:9090', {}, (r) =>
        r.text(),
      ),
    ).rejects.toThrow('cannot target localhost');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails a DNS lookup that never answers after the timeout', async () => {
    jest.useFakeTimers();
    try {
      mockLookup.mockReturnValueOnce(new Promise(() => undefined));
      global.fetch = jest.fn();
      const pending = requestPrivateAgentEndpoint(
        'https://hung.example.com',
        {},
        (r) => r.text(),
      );
      const assertion = expect(pending).rejects.toThrow('timed out');
      await jest.advanceTimersByTimeAsync(10_000);
      await assertion;
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops a DNS lookup when the request is aborted', async () => {
    mockLookup.mockReturnValueOnce(new Promise(() => undefined));
    global.fetch = jest.fn();
    const controller = new AbortController();
    const pending = requestPrivateAgentEndpoint(
      'https://hung.example.com',
      { signal: controller.signal },
      (r) => r.text(),
    );
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('allows private service addresses with a pinned dispatcher', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    global.fetch = jest.fn().mockResolvedValue(new Response('ok'));

    await expect(
      requestPrivateAgentEndpoint('http://prometheus.internal:9090', {}, (r) =>
        r.text(),
      ),
    ).resolves.toBe('ok');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://prometheus.internal:9090',
      expect.objectContaining({
        redirect: 'error',
        dispatcher: expect.anything(),
      }),
    );

    const pinned = createAgentPinnedLookup({ address: '10.0.0.5', family: 4 });
    const callback = jest.fn();
    pinned('prometheus.internal', { all: false }, callback);
    expect(callback).toHaveBeenCalledWith(null, '10.0.0.5', 4);
    pinned('prometheus.internal', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: '10.0.0.5', family: 4 },
    ]);
  });

  it('errors once a response body passes the byte cap', async () => {
    await expect(
      capResponseBody(new Response('x'.repeat(11)), 10).text(),
    ).rejects.toThrow('exceeded 10 bytes');
    await expect(
      capResponseBody(new Response('x'.repeat(10)), 10).text(),
    ).resolves.toHaveLength(10);
  });
});
