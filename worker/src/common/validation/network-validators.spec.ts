import {
  isReservedPort,
  validatePingTarget,
  validatePort,
  validatePortCheckTarget,
  validateProtocol,
  validateTargetUrl,
} from './network-validators';

describe('network-validators', () => {
  const originalAllowInternal = process.env.ALLOW_INTERNAL_TARGETS;

  afterEach(() => {
    if (originalAllowInternal === undefined) {
      delete process.env.ALLOW_INTERNAL_TARGETS;
    } else {
      process.env.ALLOW_INTERNAL_TARGETS = originalAllowInternal;
    }
  });

  describe('validateTargetUrl', () => {
    it.each([
      'https://example.com',
      'http://example.com/path?query=1',
      'https://api.example.com:8443/health',
    ])('accepts public target %s', (target) => {
      expect(validateTargetUrl(target)).toEqual({ valid: true });
    });

    it.each([
      'ftp://example.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ws://example.com',
    ])('rejects non-HTTP protocol %s', (target) => {
      const result = validateTargetUrl(target);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Only HTTP and HTTPS protocols are allowed');
    });

    it.each([
      'http://localhost',
      'http://127.0.0.1',
      'http://0.0.0.0:8080',
      'http://10.0.0.5',
      'http://192.168.1.10',
      'http://172.16.0.1',
      'http://172.31.255.254',
      'http://169.254.169.254',
      'http://[::1]',
      'http://[::ffff:10.0.0.1]',
      'http://[fe80::1]',
      'http://metadata.google.internal',
    ])('blocks internal/private target %s (SSRF protection)', (target) => {
      const result = validateTargetUrl(target);

      expect(result.valid).toBe(false);
      expect(result.error).toContain(
        'Internal/localhost targets are not allowed',
      );
    });

    it('does not block public 172.x addresses outside the private range', () => {
      expect(validateTargetUrl('http://172.15.0.1')).toEqual({ valid: true });
      expect(validateTargetUrl('http://172.32.0.1')).toEqual({ valid: true });
    });

    it('allows internal targets when explicitly requested via options', () => {
      expect(
        validateTargetUrl('http://localhost:3000', {
          allowInternalTargets: true,
        }),
      ).toEqual({ valid: true });
    });

    it('allows internal targets when ALLOW_INTERNAL_TARGETS is set', () => {
      process.env.ALLOW_INTERNAL_TARGETS = 'true';

      expect(validateTargetUrl('http://192.168.1.10')).toEqual({ valid: true });
    });

    it.each(['not a url', '', 'example.com'])(
      'rejects malformed URL "%s"',
      (target) => {
        const result = validateTargetUrl(target);

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid URL format');
      },
    );
  });

  describe('validatePingTarget', () => {
    it.each([
      ['public IPv4', '8.8.8.8'],
      ['public hostname', 'example.com'],
      ['subdomain', 'api.example.com'],
      ['hostname with hyphens', 'my-host-01.example.com'],
    ])('accepts %s', (_label, target) => {
      expect(validatePingTarget(target)).toEqual({ valid: true });
    });

    it('trims surrounding whitespace', () => {
      expect(validatePingTarget('  example.com  ')).toEqual({ valid: true });
    });

    it('rejects an empty string', () => {
      const result = validatePingTarget('');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Target must be a non-empty string');
    });

    it('rejects whitespace-only input after trimming', () => {
      const result = validatePingTarget('   ');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Target must be between 1 and 253 characters');
    });

    it('rejects non-string input', () => {
      const result = validatePingTarget(123 as unknown as string);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Target must be a non-empty string');
    });

    it('rejects targets longer than 253 characters', () => {
      const result = validatePingTarget(`${'a'.repeat(250)}.com`);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 1 and 253 characters');
    });

    it.each([
      ['semicolon', 'example.com; rm -rf /'],
      ['pipe', 'example.com | cat /etc/passwd'],
      ['backtick', 'example.com`whoami`'],
      ['dollar', 'example.com$(id)'],
      ['parentheses', 'example.com(id)'],
      ['redirect', 'example.com> /tmp/x'],
      ['quote', "example.com'"],
      ['double quote', 'example.com"'],
      ['backslash', 'example.com\\'],
      ['brackets', 'example.com[0]'],
    ])('rejects command injection via %s', (_label, target) => {
      const result = validatePingTarget(target);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Target contains invalid characters');
    });

    it('rejects an IPv4 address with an out-of-range octet', () => {
      const result = validatePingTarget('256.1.1.1');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid IPv4 address');
    });

    it('treats four-digit octets as a hostname rather than an IP', () => {
      // 1234.1.1.1 does not match the IPv4 pattern, so it is validated as a
      // hostname and accepted.
      expect(validatePingTarget('1234.1.1.1')).toEqual({ valid: true });
    });

    it.each(['10.0.0.1', '192.168.0.1', '172.16.5.5', '172.31.0.1'])(
      'blocks private IPv4 %s',
      (target) => {
        const result = validatePingTarget(target);

        expect(result.valid).toBe(false);
        expect(result.error).toContain(
          'Internal/localhost targets are not allowed',
        );
      },
    );

    it('allows private IPv4 when ALLOW_INTERNAL_TARGETS is set', () => {
      process.env.ALLOW_INTERNAL_TARGETS = 'true';

      expect(validatePingTarget('10.0.0.1')).toEqual({ valid: true });
    });

    it.each(['localhost', 'LOCALHOST'])(
      'blocks internal hostname %s',
      (target) => {
        const result = validatePingTarget(target);

        expect(result.valid).toBe(false);
        expect(result.error).toContain(
          'Internal/localhost targets are not allowed',
        );
      },
    );

    it('rejects hostnames with invalid characters', () => {
      const result = validatePingTarget('bad_host!.com');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid hostname format');
    });

    it('accepts public IPv6 addresses', () => {
      expect(validatePingTarget('2606:4700:4700::1111')).toEqual({
        valid: true,
      });
    });

    it.each([
      ['loopback', '::1'],
      ['unspecified', '::'],
      ['IPv4-mapped private', '::ffff:10.0.0.1'],
      ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
      ['link-local', 'fe80::1'],
      ['unique local', 'fd00::1'],
      ['documentation range', '2001:db8::1'],
    ])('blocks internal IPv6 target (%s)', (_label, target) => {
      const result = validatePingTarget(target);

      expect(result.valid).toBe(false);
      expect(result.error).toContain(
        'Internal/localhost targets are not allowed',
      );
    });

    it('allows internal IPv6 targets when ALLOW_INTERNAL_TARGETS is set', () => {
      process.env.ALLOW_INTERNAL_TARGETS = 'true';

      expect(validatePingTarget('::1')).toEqual({ valid: true });
    });
  });

  describe('validatePort', () => {
    it.each([1, 80, 443, 8080, 65535])('accepts port %s', (port) => {
      expect(validatePort(port)).toEqual({ valid: true });
    });

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['above max', 65536],
      ['non-integer', 80.5],
      ['NaN', Number.NaN],
    ])('rejects %s', (_label, port) => {
      const result = validatePort(port);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Port must be an integer between 1 and 65535');
    });
  });

  describe('validateProtocol', () => {
    it.each(['tcp', 'TCP', 'udp', 'UDP'])('accepts %s', (protocol) => {
      expect(validateProtocol(protocol)).toEqual({ valid: true });
    });

    it.each(['http', 'icmp', ''])('rejects %s', (protocol) => {
      const result = validateProtocol(protocol);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Protocol must be either "tcp" or "udp"');
    });
  });

  describe('validatePortCheckTarget', () => {
    it('accepts a valid host/port/protocol combination', () => {
      expect(validatePortCheckTarget('example.com', 443, 'tcp')).toEqual({
        valid: true,
      });
    });

    it('propagates target validation errors first', () => {
      const result = validatePortCheckTarget('10.0.0.1', 443, 'tcp');

      expect(result.valid).toBe(false);
      expect(result.error).toContain(
        'Internal/localhost targets are not allowed',
      );
    });

    it('propagates port validation errors', () => {
      const result = validatePortCheckTarget('example.com', 70000, 'tcp');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Port must be an integer');
    });

    it('propagates protocol validation errors', () => {
      const result = validatePortCheckTarget('example.com', 443, 'sctp');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Protocol must be either');
    });
  });

  describe('isReservedPort', () => {
    it.each([22, 25, 53, 80, 443])('flags reserved port %s', (port) => {
      expect(isReservedPort(port)).toBe(true);
    });

    it.each([8080, 3000, 8443])('does not flag port %s', (port) => {
      expect(isReservedPort(port)).toBe(false);
    });
  });
});
