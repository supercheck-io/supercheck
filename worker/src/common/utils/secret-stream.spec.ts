import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createSecretStream, scrubSecretsFromReportDir } from './secret-stream';

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

describe('scrubSecretsFromReportDir', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scrub-'));
  });
  afterEach(() => fsp.rm(dir, { recursive: true, force: true }));
  const secrets = { TOKEN: 'a&b<c>"d\'e-secret' };

  it('leaves bundled .js/.css untouched but scrubs raw and entity-escaped text', async () => {
    const bundle = 'var secret = "a&b<c>\\"d\'e-secret";';
    await fsp.writeFile(path.join(dir, 'app.js'), bundle);
    await fsp.writeFile(path.join(dir, 'app.css'), bundle);
    await fsp.writeFile(
      path.join(dir, 'index.html'),
      `raw a&b<c>"d'e-secret / esc a&amp;b&lt;c&gt;&quot;d&#39;e-secret`,
    );
    await scrubSecretsFromReportDir(dir, secrets);
    expect(await fsp.readFile(path.join(dir, 'app.js'), 'utf8')).toBe(bundle);
    expect(await fsp.readFile(path.join(dir, 'app.css'), 'utf8')).toBe(bundle);
    expect(await fsp.readFile(path.join(dir, 'index.html'), 'utf8')).toBe(
      'raw [SECRET] / esc [SECRET]',
    );
  });

  it('skips oversized text files with a warning instead of throwing', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const big = path.join(dir, 'big.html');
    await fsp.writeFile(big, '');
    await fsp.truncate(big, 21 * 1024 * 1024);
    await expect(
      scrubSecretsFromReportDir(dir, secrets),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('big.html'));
    warn.mockRestore();
  });
});
