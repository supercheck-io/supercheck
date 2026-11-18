import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  createSecretStream,
  readZip,
  scrubSecretsFromReportDir,
} from './secret-stream';

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

  it('scrubs secrets inside the zip Playwright embeds in index.html', async () => {
    // A real zip (deflated report.json and a data file), as the HTML reporter embeds it.
    const zip =
      'UEsDBBQAAAAIACYTc10dcW7mSgAAAEkAAAALAAAAcmVwb3J0Lmpzb26rVkotKsovKlayiq5Wyk0tLk5MT1WyUgpKTU7NLEtNsVJwSk0sSi1SKM7WzQEK6BanJhellugaGhmbmCok5qUo5OYXpSrVxtYCAFBLAwQUAAAACAAmE3NdvUreChQAAAASAAAACwAAAGFiYzEyMy5qc29uq1YqLknJLy1RslJKzklNzFOqBQBQSwECFAMUAAAACAAmE3NdHXFu5koAAABJAAAACwAAAAAAAAAAAAAAgAEAAAAAcmVwb3J0Lmpzb25QSwECFAMUAAAACAAmE3NdvUreChQAAAASAAAACwAAAAAAAAAAAAAAgAFzAAAAYWJjMTIzLmpzb25QSwUGAAAAAAIAAgByAAAAsAAAAAAA';
    const page = (b64: string) =>
      `<html></html>\n<template id="playwrightReportBase64">data:application/zip;base64,${b64}</template>`;
    await fsp.writeFile(path.join(dir, 'index.html'), page(zip));
    await scrubSecretsFromReportDir(dir, { KEY: 'sk-live-secret-12345' });
    const html = await fsp.readFile(path.join(dir, 'index.html'), 'utf8');
    const embedded = /base64,([A-Za-z0-9+/=]+)<\/template>/.exec(html)![1];
    const entries = readZip(Buffer.from(embedded, 'base64'));
    expect(entries.map((e) => e.name.toString())).toEqual([
      'report.json',
      'abc123.json',
    ]);
    expect(entries[0].data.toString()).toBe(
      '{"errors":[{"message":"Received: Bearer [SECRET] and more"}]}',
    );
    expect(entries[1].data.toString()).toBe('{"stdout":"clean"}');
  });

  it('fails closed when the embedded report zip is corrupt', async () => {
    await fsp.writeFile(
      path.join(dir, 'index.html'),
      '<template id="playwrightReportBase64">data:application/zip;base64,AAAA</template>',
    );
    await expect(scrubSecretsFromReportDir(dir, secrets)).rejects.toThrow();
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
