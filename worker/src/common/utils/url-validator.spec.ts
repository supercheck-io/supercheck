import {
  allowInternalWebhookTargets,
  isMetadataOrLinkLocalAddress,
  isPrivateOrReservedAddress,
  isUrlSafeForOutbound,
} from './url-validator';

describe('worker outbound address policy', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '192.168.0.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '2001:0:4136:e378::1',
    '2002:7f00:1::',
    '64:ff9b::7f00:1',
    '::ffff:127.0.0.1',
    '::ffff:ac12:5',
    '[::ffff:ac12:5]',
  ])('rejects non-public address %s', (address) => {
    expect(isPrivateOrReservedAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '203.0.114.10',
    '::ffff:8.8.8.8',
    '2606:4700:4700::1111',
  ])('allows public address %s', (address) => {
    expect(isPrivateOrReservedAddress(address)).toBe(false);
  });
});

describe('metadata and link-local policy', () => {
  it.each([
    '169.254.169.254',
    '100.100.100.200',
    '168.63.129.16',
    'fe80::1',
    'fd00:ec2::254',
    '::ffff:169.254.169.254',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b:1::1',
    '2002:a9fe:a9fe::1',
    '::a9fe:a9fe',
    '[::a9fe:a9fe]',
    '64:ff9b::6464:64c8',
  ])('blocks %s', (address) => {
    expect(isMetadataOrLinkLocalAddress(address)).toBe(true);
  });
  it.each([
    '10.0.0.5',
    '8.8.8.8',
    '::1',
    '64:ff9b::808:808',
    '2002:0a00:0005::1',
  ])('leaves %s to the private-range policy', (address) => {
    expect(isMetadataOrLinkLocalAddress(address)).toBe(false);
  });
});

describe('internal webhook targets (self-hosted opt-in)', () => {
  const saved = {
    SELF_HOSTED: process.env.SELF_HOSTED,
    ALLOW_INTERNAL_TARGETS: process.env.ALLOW_INTERNAL_TARGETS,
  };
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it.each([
    [undefined, 'true'],
    ['true', undefined],
    ['true', '1'],
  ])(
    'stays strict for SELF_HOSTED=%s ALLOW_INTERNAL_TARGETS=%s',
    (sh, allow) => {
      if (sh === undefined) delete process.env.SELF_HOSTED;
      else process.env.SELF_HOSTED = sh;
      if (allow === undefined) delete process.env.ALLOW_INTERNAL_TARGETS;
      else process.env.ALLOW_INTERNAL_TARGETS = allow;
      expect(allowInternalWebhookTargets()).toBe(false);
    },
  );

  it('allows private and http only with the flag, and always blocks metadata', () => {
    process.env.SELF_HOSTED = 'true';
    process.env.ALLOW_INTERNAL_TARGETS = 'true';
    expect(allowInternalWebhookTargets()).toBe(true);
    for (const url of ['http://10.0.0.5:8080/h', 'http://localhost/h']) {
      expect(isUrlSafeForOutbound(url, { allowInternal: true }).safe).toBe(
        true,
      );
      expect(isUrlSafeForOutbound(url).safe).toBe(false);
    }
    for (const url of [
      'http://169.254.169.254/x',
      'http://[fd00:ec2::254]/x',
      'http://metadata.google.internal/x',
    ]) {
      expect(isUrlSafeForOutbound(url, { allowInternal: true }).safe).toBe(
        false,
      );
    }
  });
});
