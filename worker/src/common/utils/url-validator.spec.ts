import { isPrivateOrReservedAddress } from './url-validator';

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
  ])('rejects non-public address %s', (address) => {
    expect(isPrivateOrReservedAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '203.0.114.10', '2606:4700:4700::1111'])(
    'allows public address %s',
    (address) => {
      expect(isPrivateOrReservedAddress(address)).toBe(false);
    },
  );
});
