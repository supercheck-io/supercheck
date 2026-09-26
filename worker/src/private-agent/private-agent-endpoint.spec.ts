import { lookup } from 'node:dns/promises';
import {
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

  it.each(['127.0.0.2', '169.254.169.254', '::1', '::ffff:127.0.0.1'])(
    'rejects forbidden resolved address %s before fetch',
    async (address) => {
      mockLookup.mockResolvedValueOnce([
        { address, family: address.includes(':') ? 6 : 4 },
      ]);
      global.fetch = jest.fn() as unknown as typeof fetch;

      await expect(
        requestPrivateAgentEndpoint('https://internal.example.com', {}, (r) =>
          r.text(),
        ),
      ).rejects.toThrow('cannot target localhost');
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it('rejects mixed DNS answers and trailing-dot localhost', async () => {
    mockLookup.mockResolvedValueOnce([
      { address: '10.0.0.5', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    global.fetch = jest.fn() as unknown as typeof fetch;

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

  it('allows private service addresses with a pinned dispatcher', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('ok')) as unknown as typeof fetch;

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
});
