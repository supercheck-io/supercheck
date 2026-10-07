import { createSecretStream } from './secret-stream';

describe('secret console stream', () => {
  it('redacts a secret split at every possible transport boundary and flushes its tail', async () => {
    const secret = 'private-token';
    for (let split = 1; split < secret.length; split++) {
      const chunks: string[] = [];
      const stream = createSecretStream({ TOKEN: secret }, async (text) => {
        chunks.push(text);
      });
      await stream.write(`before ${secret.slice(0, split)}`);
      await stream.write(`${secret.slice(split)} after`);
      await stream.flush();
      expect(chunks.join('')).toBe('before [SECRET] after');
    }
  });
  it('forwards immediately without secrets and handles overlapping values', async () => {
    const emit = jest.fn(async () => undefined);
    const plain = createSecretStream({}, emit);
    await plain.write('hello');
    expect(emit).toHaveBeenCalledWith('hello');
    const chunks: string[] = [];
    const stream = createSecretStream(
      { A: 'abc', B: 'bcdef' },
      async (text) => {
        chunks.push(text);
      },
    );
    await stream.write('abcdef');
    await stream.write(' xyz');
    await stream.flush();
    expect(chunks.join('')).not.toContain('abc');
    expect(chunks.join('')).not.toContain('bcdef');
  });
});
