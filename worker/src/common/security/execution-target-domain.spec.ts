import {
  TargetDnsUnavailableError,
  normalizeTargetHostname,
  resolvePublicTargetAddresses,
  verifyTargetDns,
} from './execution-target-domain';

const resolver = {
  resolveTxt: jest.fn(),
  resolve4: jest.fn(),
  resolve6: jest.fn(),
};
beforeEach(() => {
  resolver.resolveTxt.mockResolvedValue([['supercheck-load-test=org-token']]);
  resolver.resolve4.mockResolvedValue(['93.184.216.34']);
  resolver.resolve6.mockRejectedValue(new Error('no AAAA'));
});
it('canonicalizes an exact hostname without allowing a URL or wildcard', () => {
  expect(normalizeTargetHostname('TARGET.Example.com.')).toBe(
    'target.example.com',
  );
});
it.each([
  'https://example.com',
  'example.com/path',
  ' example.com',
  '*.example.com',
  '127.0.0.1',
  '[::1]',
  'localhost',
  'x.internal',
  'bad..example.com',
  'example.com:443',
  'x/example.com',
  '127.1',
  '0x7f.1',
  'a.b.0x7f',
  'target.123',
])('rejects invalid execution target %s', (hostname) => {
  expect(() => normalizeTargetHostname(hostname)).toThrow();
});
it("requires this organization's exact TXT proof and public addresses", async () => {
  expect(
    await verifyTargetDns('target.example.com', 'org-token', resolver),
  ).toEqual(['93.184.216.34']);
  expect(resolver.resolveTxt).toHaveBeenCalledWith(
    '_supercheck-load-test.target.example.com',
  );
  resolver.resolveTxt.mockResolvedValue([['supercheck-load-test=another-org']]);
  await expect(
    verifyTargetDns('target.example.com', 'org-token', resolver),
  ).rejects.toThrow('ownership');
});
it.each([
  '127.0.0.1',
  '169.254.169.254',
  '10.0.0.1',
  '::1',
  '::ffff:10.0.0.1',
  'fc00::1',
])(
  'rejects a private answer even alongside a public answer: %s',
  async (address) => {
    resolver.resolve4.mockResolvedValue(['93.184.216.34', address]);
    await expect(
      verifyTargetDns('target.example.com', 'org-token', resolver),
    ).rejects.toThrow('public');
  },
);
it('re-resolves on every verification and fails closed on DNS failure or rebinding', async () => {
  await verifyTargetDns('target.example.com', 'org-token', resolver);
  resolver.resolve4.mockResolvedValue(['10.0.0.1']);
  await expect(
    verifyTargetDns('target.example.com', 'org-token', resolver),
  ).rejects.toThrow();
  resolver.resolve4.mockRejectedValue(new Error('DNS unavailable'));
  await expect(
    verifyTargetDns('target.example.com', 'org-token', resolver),
  ).rejects.toThrow();
});
const dnsError = (code: string) => Object.assign(new Error(code), { code });
describe('resolver outages are not proof about the target', () => {
  it.each(['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED'])(
    'treats %s on the ownership lookup as temporary',
    async (code) => {
      resolver.resolveTxt.mockRejectedValue(dnsError(code));
      await expect(
        verifyTargetDns('target.example.com', 'org-token', resolver),
      ).rejects.toBeInstanceOf(TargetDnsUnavailableError);
    },
  );
  it('treats a missing TXT record as failed ownership, not an outage', async () => {
    resolver.resolveTxt.mockRejectedValue(dnsError('ENODATA'));
    await expect(
      verifyTargetDns('target.example.com', 'org-token', resolver),
    ).rejects.toThrow('ownership');
  });
  it('treats failing address lookups as temporary only when nothing answered', async () => {
    resolver.resolve4.mockRejectedValue(dnsError('ETIMEOUT'));
    resolver.resolve6.mockRejectedValue(dnsError('ETIMEOUT'));
    await expect(
      resolvePublicTargetAddresses('target.example.com', resolver),
    ).rejects.toBeInstanceOf(TargetDnsUnavailableError);
    resolver.resolve4.mockRejectedValue(dnsError('ENODATA'));
    resolver.resolve6.mockRejectedValue(dnsError('ENODATA'));
    await expect(
      resolvePublicTargetAddresses('target.example.com', resolver),
    ).rejects.toThrow('public addresses');
  });
  it('still checks every address on its own, without the ownership proof', async () => {
    resolver.resolveTxt.mockClear();
    resolver.resolve6.mockResolvedValue(['::1']);
    await expect(
      resolvePublicTargetAddresses('target.example.com', resolver),
    ).rejects.toThrow('public addresses');
    expect(resolver.resolveTxt).not.toHaveBeenCalled();
  });
});
