import { decryptSecret, encryptSecret } from './secret-crypto';

describe('worker secret encryption key validation', () => {
  const originalKey = process.env.SECRET_ENCRYPTION_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
    else process.env.SECRET_ENCRYPTION_KEY = originalKey;
  });

  it.each(['CHANGE_THIS', 'change-this', 'ChangeThis'])(
    'rejects placeholder key %s',
    (placeholder) => {
      process.env.SECRET_ENCRYPTION_KEY = placeholder.padEnd(64, '_');
      expect(() => encryptSecret('secret')).toThrow('placeholder value');
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
