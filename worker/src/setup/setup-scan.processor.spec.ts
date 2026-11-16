import { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import {
  SCAN_LIMITS,
  extractLinks,
  extractTitle,
  processSetupScan,
  type SetupScanDeps,
} from './setup-scan.processor';

const HOME = 'http://93.184.216.34/';

type Reply = {
  status: number;
  headers?: Record<string, unknown>;
  data?: unknown;
};
const reply = (r: Reply): AxiosResponse =>
  ({
    headers: {},
    data: '',
    statusText: '',
    config: {},
    ...r,
  }) as AxiosResponse;

function scan(
  handler: (config: AxiosRequestConfig<unknown>) => Reply | Promise<Reply>,
  extra: Partial<SetupScanDeps> = {},
  url = HOME,
) {
  const calls: AxiosRequestConfig<unknown>[] = [];
  const execute = jest.fn(async (config: AxiosRequestConfig<unknown>) => {
    calls.push(config);
    return reply(await handler(config));
  });
  const result = processSetupScan(
    { url, junk: 1 },
    { execute, allowInternalTargets: () => false, ...extra },
  );
  return { result, calls, execute };
}

const page = (title: string, links: string[] = []) =>
  `<html><head><title>${title}</title></head><body>${links.map((l) => `<a href="${l}">x</a>`).join('')}</body></html>`;

describe('setup scan processor', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the pinned request with caps and returns title, pages and no bodies or headers', async () => {
    const { result, calls } = scan((c) => ({
      status: 200,
      headers: { 'set-cookie': 'secret=1', server: 'nginx' },
      data: String(c.url).endsWith('/about')
        ? page('About  us')
        : page('Acme &amp; Co', [
            '/about',
            '/about#team',
            '/about?x=1',
            'https://other.example/a',
            '/app.css',
            '/logo.png',
            'mailto:a@b.c',
            'tel:123',
            '/doc.pdf',
          ]),
    }));
    const r = await result;

    expect(r).toMatchObject({
      reachable: true,
      status: 200,
      redirects: 0,
      finalUrl: 'http://93.184.216.34/',
      ssl: null,
    });
    expect(r.pages.map((p) => [p.path, p.status, p.title])).toEqual([
      ['/', 200, 'Acme & Co'],
      ['/about', 200, 'About us'],
    ]);
    expect(calls[0]).toMatchObject({
      maxContentLength: 512 * 1024,
      maxBodyLength: 512 * 1024,
      responseType: 'text',
      maxRedirects: 0, // redirects are followed by the pinned helper, hop by hop
    });
    expect(calls[0].validateStatus?.(500)).toBe(true);
    expect(calls[0].httpAgent).toBeDefined(); // pinned agents attached
    expect(JSON.stringify(r)).not.toMatch(/secret|nginx|<html|set-cookie/i);
  });

  it('caps pages at 20 and candidate links at 50', async () => {
    const links = Array.from({ length: 80 }, (_, i) => `/p${i}`);
    const { result, execute } = scan(() => ({
      status: 200,
      data: page('t', links),
    }));
    const r = await result;
    expect(r.pages).toHaveLength(SCAN_LIMITS.maxPages);
    expect(execute).toHaveBeenCalledTimes(SCAN_LIMITS.maxPages);
    expect(extractLinks(page('t', links), new URL(HOME))).toHaveLength(
      SCAN_LIMITS.maxCandidateLinks,
    );
  });

  it('reports too_many_redirects after 5 hops and counts redirects', async () => {
    const loop = await scan(() => ({
      status: 302,
      headers: { location: '/next' },
    })).result;
    expect(loop).toMatchObject({
      reachable: false,
      error: 'too_many_redirects',
    });

    let n = 0;
    const ok = await scan(() =>
      n++ < 2
        ? { status: 301, headers: { location: '/r' } }
        : { status: 200, data: page('T') },
    ).result;
    expect(ok).toMatchObject({
      reachable: true,
      redirects: 2,
      finalUrl: 'http://93.184.216.34/r',
    });
  });

  it('keeps the status when a body exceeds 512 KB and reads no page', async () => {
    const err = Object.assign(
      new AxiosError(
        'maxContentLength size of 524288 exceeded',
        AxiosError.ERR_BAD_RESPONSE,
      ),
      { request: { res: { statusCode: 200 } } },
    );
    const r = await scan(() => {
      throw err;
    }).result;
    expect(r).toMatchObject({
      reachable: true,
      status: 200,
      pages: [{ path: '/', status: 200, title: null }],
    });
  });

  it('stops crawling when the 60 s budget aborts and bounds each request to 10 s', async () => {
    const budget = new AbortController();
    const real = AbortSignal.timeout.bind(AbortSignal);
    const spy = jest
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((ms: number) =>
        ms === SCAN_LIMITS.totalBudgetMs ? budget.signal : real(ms),
      );
    const { result, calls } = scan(() => {
      budget.abort();
      return { status: 200, data: page('t', ['/a', '/b']) };
    });
    const r = await result;
    expect(spy).toHaveBeenCalledWith(SCAN_LIMITS.requestTimeoutMs);
    expect(calls[0].signal?.aborted).toBe(true); // request signal follows the shared budget
    expect(r.pages).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('maps timeouts, bot protection and failures to short codes', async () => {
    expect(
      (
        await scan(() => {
          throw new AxiosError('x', 'ECONNABORTED');
        }).result
      ).error,
    ).toBe('timeout');
    expect(
      (
        await scan(() => {
          throw new Error('boom');
        }).result
      ).error,
    ).toBe('unreachable');
    const bot = await scan(() => ({
      status: 403,
      headers: { server: 'cloudflare' },
      data: 'Just a moment...',
    })).result;
    expect(bot).toMatchObject({
      reachable: true,
      status: 403,
      error: 'bot_protection',
    });
    const plain403 = await scan(() => ({ status: 403, data: 'forbidden' }))
      .result;
    expect(plain403.error).toBeUndefined();
    expect((await processSetupScan({ url: 'ftp://x' })).error).toBe(
      'unreachable',
    );
    expect((await processSetupScan(null)).error).toBe('unreachable');
  });

  it('blocks private, loopback and metadata targets before any request', async () => {
    for (const url of [
      'http://10.0.0.5/',
      'http://127.0.0.1/',
      'http://169.254.169.254/',
    ]) {
      const { result, execute } = scan(() => ({ status: 200 }), {}, url);
      expect(await result).toMatchObject({
        reachable: false,
        error: 'blocked_private',
        blockedReason: expect.any(String),
      });
      expect(execute).not.toHaveBeenCalled();
    }
    // Internal targets are a worker setting; metadata stays blocked regardless.
    const internal = scan(
      () => ({ status: 200, data: page('Intra') }),
      { allowInternalTargets: () => true },
      'http://10.0.0.5/',
    );
    expect((await internal.result).reachable).toBe(true);
    const meta = scan(
      () => ({ status: 200 }),
      { allowInternalTargets: () => true },
      'http://169.254.169.254/',
    );
    expect((await meta.result).error).toBe('blocked_private');
  });

  it('re-checks redirects: a hop to a private address is blocked', async () => {
    const r = await scan(() => ({
      status: 302,
      headers: { location: 'http://10.1.1.1/' },
    })).result;
    expect(r).toMatchObject({ reachable: false, error: 'blocked_private' });
  });

  it('flags a page whose request ended on a different path, such as a login page', async () => {
    const r = await scan((c) => {
      const path = new URL(String(c.url)).pathname;
      if (path === '/')
        return {
          status: 200,
          data: page('Home', ['/account', '/pricing', '/docs/']),
        };
      if (path === '/account')
        return { status: 302, headers: { location: '/login' } };
      if (path === '/login') return { status: 200, data: page('Sign in') };
      return { status: 200, data: page('Other') };
    }).result;
    const byPath = Object.fromEntries(r.pages.map((p) => [p.path, p]));
    expect(byPath['/account']).toMatchObject({
      redirected: true,
      finalPath: '/login',
      status: 200,
    });
    expect(byPath['/pricing'].redirected).toBeUndefined();
    expect(byPath['/docs/'].redirected).toBeUndefined();
  });

  it('reads the certificate before crawling so a slow crawl cannot starve it', async () => {
    const order: string[] = [];
    const readCertificate = jest.fn().mockImplementation(async () => {
      order.push('cert');
      return {
        validTo: new Date(Date.now() + 86_400_000).toISOString(),
        daysRemaining: 1,
        issuer: 'CA',
      };
    });
    await scan(
      (c) => {
        order.push(new URL(String(c.url)).pathname);
        return { status: 200, data: page('x', ['/a']) };
      },
      { readCertificate },
      'https://93.184.216.34/',
    ).result;
    expect(order).toEqual(['/', 'cert', '/a']);
  });

  it('reads the certificate through a vetted lookup for https targets', async () => {
    const readCertificate = jest.fn().mockResolvedValue({
      validTo: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      daysRemaining: 10,
      issuer: 'Test CA',
    });
    const r = await scan(
      () => ({ status: 200, data: page('Secure') }),
      { readCertificate },
      'https://93.184.216.34/',
    ).result;
    expect(r.ssl).toMatchObject({
      issuer: 'Test CA',
      daysRemaining: expect.any(Number),
    });
    expect(r.ssl?.daysRemaining).toBe(10);
    const args = readCertificate.mock.calls[0][0];
    expect(args).toMatchObject({ hostname: '93.184.216.34', port: 443 });
    // The lookup only yields the vetted address.
    const addr = await new Promise((resolve) =>
      args.lookup('whatever', { all: true }, (_e: unknown, a: unknown) =>
        resolve(a),
      ),
    );
    expect(addr).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('reports an invalid certificate as ssl_invalid with the reason and no date', async () => {
    const readCertificate = jest
      .fn()
      .mockResolvedValue({ invalid: true, reason: 'CERT_HAS_EXPIRED' });
    const r = await scan(
      () => {
        throw new AxiosError('certificate has expired', 'CERT_HAS_EXPIRED');
      },
      { readCertificate },
      'https://93.184.216.34/',
    ).result;
    expect(r).toMatchObject({
      reachable: false,
      error: 'ssl_invalid',
      ssl: null,
      sslReason: 'CERT_HAS_EXPIRED',
    });
    expect(readCertificate).toHaveBeenCalledTimes(1);
  });

  it('reads the certificate of the redirect target that failed, not the origin it started from', async () => {
    const readCertificate = jest
      .fn()
      .mockResolvedValue({ invalid: true, reason: 'CERT_HAS_EXPIRED' });
    let calls = 0;
    const r = await scan(
      () => {
        if (++calls === 1) {
          return {
            status: 302,
            headers: { location: 'https://93.184.216.35/' },
          };
        }
        throw new AxiosError('certificate has expired', 'CERT_HAS_EXPIRED');
      },
      { readCertificate },
      'https://93.184.216.34/',
    ).result;
    expect(r).toMatchObject({ error: 'ssl_invalid', ssl: null });
    expect(readCertificate).toHaveBeenCalledTimes(1);
    expect(readCertificate.mock.calls[0][0]).toMatchObject({
      hostname: '93.184.216.35',
    });
  });

  it('keeps ssl_invalid when the certificate itself cannot be read', async () => {
    const r = await scan(
      () => {
        throw new AxiosError('self signed', 'DEPTH_ZERO_SELF_SIGNED_CERT');
      },
      { readCertificate: jest.fn().mockRejectedValue(new Error('tls')) },
      'https://93.184.216.34/',
    ).result;
    expect(r).toMatchObject({
      error: 'ssl_invalid',
      ssl: null,
      sslReason: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
  });

  it('returns ssl null when the certificate cannot be read', async () => {
    const fail = jest.fn().mockRejectedValue(new Error('tls'));
    const failed = await scan(
      () => ({ status: 200 }),
      { readCertificate: fail },
      'https://93.184.216.34/',
    ).result;
    expect(failed.ssl).toBeNull();
    const noDate = jest
      .fn()
      .mockResolvedValue({ invalid: true, reason: 'CERT_HAS_EXPIRED' });
    const undated = await scan(
      () => ({ status: 200 }),
      { readCertificate: noDate },
      'https://93.184.216.34/',
    ).result;
    expect(undated.ssl).toBeNull();
  });

  it('skips over-long paths and off-host `//` paths', async () => {
    const long = '/' + 'a'.repeat(300);
    const html = page('t', ['/ok', long, '/.//evil.com/x']);
    expect(extractLinks(html, new URL(HOME))).toEqual(['/ok']);
    const { result, calls } = scan(() => ({ status: 200, data: html }));
    const r = await result;
    expect(r.pages.map((p) => p.path)).toEqual(['/', '/ok']);
    expect(calls.every((c) => String(c.url).startsWith(HOME))).toBe(true);
  });

  it('skips the certificate read once the budget has aborted', async () => {
    const budget = new AbortController();
    const real = AbortSignal.timeout.bind(AbortSignal);
    jest
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((ms: number) =>
        ms === SCAN_LIMITS.totalBudgetMs ? budget.signal : real(ms),
      );
    const readCertificate = jest.fn();
    const r = await scan(
      () => {
        budget.abort();
        return { status: 200, data: page('t', ['/a']) };
      },
      { readCertificate },
      'https://93.184.216.34/',
    ).result;
    expect(r.ssl).toBeNull();
    expect(readCertificate).not.toHaveBeenCalled();
  });

  it('extracts titles safely', () => {
    expect(extractTitle('<title>' + 'a'.repeat(300) + '</title>')).toHaveLength(
      120,
    );
    expect(extractTitle('<title>  </title>')).toBeNull();
    expect(extractTitle('<title>&amp;lt;b&amp;gt; &lt;i&gt;</title>')).toBe(
      '&lt;b&gt; <i>',
    );
    expect(extractTitle('no title')).toBeNull();
    expect(extractTitle('<title>a\u0000<b>b</b></title>')).toBe('a b');
  });

  it('stays fast on a 512 KB body made of unterminated title tags', () => {
    const size = 512 * 1024;
    for (const unit of ['<title', '<title>', '<title ' + 'x'.repeat(400)]) {
      const body = unit.repeat(Math.ceil(size / unit.length));
      const started = Date.now();
      expect(extractTitle(body)).toBeNull();
      expect(Date.now() - started).toBeLessThan(1000);
    }
    expect(
      extractTitle('x'.repeat(70 * 1024) + '<title>late</title>'),
    ).toBeNull();
  });
});
