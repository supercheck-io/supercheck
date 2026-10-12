import * as crypto from 'node:crypto';
import {
  decryptJson,
  decryptSecret,
  encryptJson,
  encryptSecret,
  isSecretEnvelope,
  maskSecret,
  type SecretEnvelope,
} from './secret-crypto';

const KEY_ENV = 'SECRET_ENCRYPTION_KEY';
const VALID_KEY = 'a'.repeat(32);
const VALID_HEX_KEY = crypto.randomBytes(32).toString('hex');

function envelopeFromPayload(payload: string): SecretEnvelope {
  return { encrypted: true, version: 1, payload };
}

describe('secret-crypto', () => {
  const originalKey = process.env[KEY_ENV];

  beforeEach(() => {
    process.env[KEY_ENV] = VALID_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env[KEY_ENV];
    } else {
      process.env[KEY_ENV] = originalKey;
    }
  });

  describe('encryptSecret / decryptSecret', () => {
    it('round-trips a secret', () => {
      const envelope = encryptSecret('super-secret-value');

      expect(decryptSecret(envelope)).toBe('super-secret-value');
    });

    it('produces a versioned AES-128-GCM envelope', () => {
      const envelope = encryptSecret('value');

      expect(envelope.encrypted).toBe(true);
      expect(envelope.version).toBe(1);

      const raw = JSON.parse(
        Buffer.from(envelope.payload, 'base64').toString('utf8'),
      );
      expect(raw.v).toBe(1);
      expect(Buffer.from(raw.iv, 'base64')).toHaveLength(12);
      expect(Buffer.from(raw.tag, 'base64')).toHaveLength(16);
      expect(typeof raw.data).toBe('string');
    });

    it('uses a fresh IV so identical plaintexts produce different payloads', () => {
      const first = encryptSecret('same-value');
      const second = encryptSecret('same-value');

      expect(first.payload).not.toBe(second.payload);
      expect(decryptSecret(first)).toBe('same-value');
      expect(decryptSecret(second)).toBe('same-value');
    });

    it('round-trips unicode content', () => {
      const value = 'pässwörd-🔐-日本語';

      expect(decryptSecret(encryptSecret(value))).toBe(value);
    });

    it('binds the ciphertext to the provided context', () => {
      const envelope = encryptSecret('value', { context: 'org:123' });

      expect(decryptSecret(envelope, { context: 'org:123' })).toBe('value');
      expect(() => decryptSecret(envelope, { context: 'org:456' })).toThrow();
    });

    it('falls back to the context stored on the envelope', () => {
      const envelope = encryptSecret('value', { context: 'org:123' });

      expect(envelope.context).toBe('org:123');
      expect(decryptSecret(envelope)).toBe('value');
    });

    it('rejects a tampered payload (GCM auth failure)', () => {
      const envelope = encryptSecret('value');
      const raw = JSON.parse(
        Buffer.from(envelope.payload, 'base64').toString('utf8'),
      );
      const data = Buffer.from(raw.data, 'base64');
      data[0] = data[0] ^ 0xff;
      raw.data = data.toString('base64');
      const tampered = envelopeFromPayload(
        Buffer.from(JSON.stringify(raw), 'utf8').toString('base64'),
      );

      expect(() => decryptSecret(tampered)).toThrow();
    });
  });

  describe('key selection', () => {
    it('throws when the key env var is missing', () => {
      delete process.env[KEY_ENV];

      expect(() => encryptSecret('value')).toThrow(
        `${KEY_ENV} environment variable is not set`,
      );
    });

    it('throws when the key is shorter than 32 characters', () => {
      process.env[KEY_ENV] = 'too-short';

      expect(() => encryptSecret('value')).toThrow(`at least 32 characters`);
    });

    it.each(['CHANGE_THIS', 'change-this', 'ChangeThis'])(
      'keeps legacy placeholder key %s working',
      (placeholder) => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          process.env[KEY_ENV] = placeholder.padEnd(64, '_');
          expect(decryptSecret(encryptSecret('secret'))).toBe('secret');
        } finally {
          warn.mockRestore();
        }
      },
    );

    it('warns once for a placeholder key and not again', async () => {
      // The warning flag is module-level, so load a fresh copy of the module.
      jest.resetModules();
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        process.env[KEY_ENV] = 'changethis'.padEnd(32, 'x');
        const fresh = await import('./secret-crypto');

        expect(fresh.decryptSecret(fresh.encryptSecret('value'))).toBe('value');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('placeholder value');

        fresh.encryptSecret('another');
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });

    it('accepts a 64-character hex key', () => {
      process.env[KEY_ENV] = VALID_HEX_KEY;

      const envelope = encryptSecret('value');
      expect(decryptSecret(envelope)).toBe('value');
    });

    it('derives the same key from hex across separate calls', () => {
      process.env[KEY_ENV] = VALID_HEX_KEY;
      const envelope = encryptSecret('value');

      process.env[KEY_ENV] = VALID_HEX_KEY.toUpperCase();
      expect(decryptSecret(envelope)).toBe('value');
    });
  });

  describe('decryptSecret validation', () => {
    it('rejects a non-encrypted envelope', () => {
      expect(() =>
        decryptSecret({ encrypted: false } as unknown as SecretEnvelope),
      ).toThrow('Invalid encrypted envelope');
    });

    it('rejects a payload that is not valid JSON', () => {
      const payload = Buffer.from('not-json', 'utf8').toString('base64');

      // JSON.parse errors are surfaced unwrapped rather than as the
      // "Invalid encrypted payload" envelope error.
      expect(() => decryptSecret(envelopeFromPayload(payload))).toThrow(
        SyntaxError,
      );
    });

    it.each([
      ['missing version', { iv: 'a', tag: 'b', data: 'c' }],
      ['wrong version', { v: 2, iv: 'a', tag: 'b', data: 'c' }],
      ['missing iv', { v: 1, tag: 'b', data: 'c' }],
      ['missing tag', { v: 1, iv: 'a', data: 'c' }],
      ['missing data', { v: 1, iv: 'a', tag: 'b' }],
    ])('rejects malformed envelope payload: %s', (_label, raw) => {
      const payload = Buffer.from(JSON.stringify(raw), 'utf8').toString(
        'base64',
      );

      expect(() => decryptSecret(envelopeFromPayload(payload))).toThrow(
        'Invalid encrypted payload',
      );
    });
  });

  describe('encryptJson / decryptJson', () => {
    it('round-trips a JSON object', () => {
      const data = { token: 'abc', nested: { enabled: true }, count: 3 };

      expect(decryptJson<typeof data>(encryptJson(data))).toEqual(data);
    });

    it('keeps context binding for JSON payloads', () => {
      const envelope = encryptJson({ a: 1 }, { context: 'project:42' });

      expect(decryptJson(envelope, { context: 'project:42' })).toEqual({
        a: 1,
      });
      expect(() => decryptJson(envelope, { context: 'project:43' })).toThrow();
    });
  });

  describe('isSecretEnvelope', () => {
    it('recognizes a valid envelope', () => {
      expect(isSecretEnvelope(encryptSecret('value'))).toBe(true);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['string', 'payload'],
      ['object without flag', { version: 1, payload: 'x' }],
      ['wrong version', { encrypted: true, version: 2, payload: 'x' }],
      ['non-string payload', { encrypted: true, version: 1, payload: 123 }],
    ])('rejects %s', (_label, value) => {
      expect(isSecretEnvelope(value)).toBe(false);
    });
  });

  describe('maskSecret', () => {
    it('returns a fixed mask for empty values', () => {
      expect(maskSecret('')).toBe('***');
    });

    it('fully masks values shorter than the visible window', () => {
      expect(maskSecret('ab', 4)).toBe('***');
      expect(maskSecret('abcd', 4)).toBe('****');
    });

    it('keeps only the edges of longer values visible', () => {
      const masked = maskSecret('sk_live_1234567890', 4);

      expect(masked.startsWith('sk')).toBe(true);
      expect(masked.endsWith('90')).toBe(true);
      expect(masked).not.toContain('live');
      expect(masked).toContain('*');
    });
  });
});
