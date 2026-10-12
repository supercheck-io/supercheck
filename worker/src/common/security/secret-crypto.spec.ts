import { decryptSecret, encryptSecret } from './secret-crypto';

describe('worker secret encryption key validation', () => {
  const originalKey = process.env.SECRET_ENCRYPTION_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
    else process.env.SECRET_ENCRYPTION_KEY = originalKey;
  });

  it.each(['CHANGE_THIS', 'change-this', 'ChangeThis'])(
    'keeps legacy placeholder key %s working',
    (placeholder) => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        process.env.SECRET_ENCRYPTION_KEY = placeholder.padEnd(64, '_');
        expect(decryptSecret(encryptSecret('secret'))).toBe('secret');
      } finally {
        warn.mockRestore();
      }
    },
  );

  it('preserves context-bound round trips with a configured key', () => {
    process.env.SECRET_ENCRYPTION_KEY = 'a1'.repeat(32);
    const envelope = encryptSecret('secret', { context: 'project-test' });
    expect(decryptSecret(envelope)).toBe('secret');
    expect(() =>
      decryptSecret(envelope, { context: 'other-project' }),
    ).toThrow();
  });
});
