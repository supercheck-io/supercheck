import { lookup } from 'node:dns/promises';

import {
  fetchSafeExternalUrl,
  resolveWebhookUrlForOutboundRequest,
  validateWebhookUrlString,
} from '@/lib/url-validator';

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

const lookupMock = jest.mocked(lookup);

describe('url-validator', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = jest.fn() as unknown as typeof global.fetch;
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

  it('forces redirect:error on validated outbound requests', async () => {
    lookupMock.mockResolvedValue(
      [{ address: '93.184.216.34', family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>,
    );

    const response = new Response('ok', { status: 200 });
    const fetchMock = jest.fn().mockResolvedValue(response);
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await expect(
      fetchSafeExternalUrl('https://example.com/hooks/test', {
        method: 'POST',
        body: 'payload',
        redirect: 'follow',
      }),
    ).resolves.toBe(response);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: 'POST',
        body: 'payload',
        redirect: 'error',
      }),
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
