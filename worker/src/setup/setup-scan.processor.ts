import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';
import {
  requestPinnedMonitorTarget,
  vettedLookup,
} from '../common/utils/pinned-monitor-request';
import { readPeerCertificate } from '../common/utils/tls-certificate';
import { allowInternalMonitorTargets } from '../common/utils/url-validator';
import {
  MonitorRedirectError,
  isTimeoutError,
} from '../common/utils/network-error';

export const SETUP_SCAN_QUEUE = 'setup-scan';

export const SCAN_LIMITS = {
  maxRedirects: 5,
  requestTimeoutMs: 10_000,
  totalBudgetMs: 60_000,
  maxBodyBytes: 512 * 1024,
  maxPages: 20,
  maxCandidateLinks: 50,
  pageConcurrency: 3,
  maxTitleLength: 120,
} as const;

export type SetupScanErrorCode =
  | 'unreachable'
  | 'blocked_private'
  | 'bot_protection'
  | 'timeout'
  | 'too_many_redirects'
  | 'ssl_invalid';

export interface SetupScanResult {
  finalUrl: string;
  reachable: boolean;
  status: number | null;
  redirects: number;
  responseMs: number | null;
  ssl: { validTo: string; daysRemaining: number; issuer: string } | null;
  pages: {
    path: string;
    status: number;
    ms: number;
    title: string | null;
    /** The request ended on a different path (e.g. a login page): not a page to suggest. */
    redirected?: boolean;
    finalPath?: string;
  }[];
  blockedReason?: string;
  error?: SetupScanErrorCode;
}

export interface SetupScanDeps {
  execute: (
    config: AxiosRequestConfig<unknown>,
  ) => Promise<AxiosResponse<unknown>>;
  readCertificate: typeof readPeerCertificate;
  allowInternalTargets: () => boolean;
}

const defaultDeps: SetupScanDeps = {
  execute: (config) => axios.request(config),
  readCertificate: readPeerCertificate,
  allowInternalTargets: allowInternalMonitorTargets,
};

const ASSET_PATH =
  /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|avif|bmp|pdf|zip|gz|woff2?|ttf|otf|eot|mp[34]|webm|xml|json|txt)$/i;
const BOT_MARKERS =
  /just a moment|cf-chl|challenge-platform|captcha|attention required|access denied|checking your browser/i;
const BLOCKED_MESSAGE = 'Access to private or reserved networks is not allowed';

const MAX_PATH_LENGTH = 300;

const originAndPath = (url: URL): string => `${url.origin}${url.pathname}`;

function cleanText(raw: string): string {
  return (
    raw
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;|&#39;|&apos;/gi, "'")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, SCAN_LIMITS.maxTitleLength)
  );
}

/** A title lives in <head>: only the start is searched, and every part of the pattern is bounded. */
const TITLE_SEARCH_CHARS = 64 * 1024;

export function extractTitle(html: string): string | null {
  const match = /<title\b[^>]{0,500}>([\s\S]{0,2000}?)<\/title>/i.exec(
    html.slice(0, TITLE_SEARCH_CHARS),
  );
  return match ? cleanText(match[1]) || null : null;
}

/** Same-origin page paths from href attributes: no fragments, queries, assets or non-http schemes. */
export function extractLinks(html: string, base: URL): string[] {
  const found = new Set<string>();
  const hrefs = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (let m = hrefs.exec(html); m; m = hrefs.exec(html)) {
    let url: URL;
    try {
      url = new URL((m[1] ?? m[2]).trim(), base);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    if (url.origin !== base.origin || ASSET_PATH.test(url.pathname)) continue;
    if (url.pathname === base.pathname) continue;
    // `//host/x` would resolve off-host when joined to the origin later; very long paths are dropped.
    if (url.pathname.startsWith('//') || url.pathname.length > MAX_PATH_LENGTH)
      continue;
    found.add(url.pathname);
    if (found.size >= SCAN_LIMITS.maxCandidateLinks) break;
  }
  return [...found];
}

interface FetchedPage {
  status: number;
  ms: number;
  finalUrl: URL;
  redirects: number;
  html: string;
  botProtected: boolean;
}

class ScanFailure extends Error {
  /** The address the failing request went to: after a redirect, not the one the scan started from. */
  url?: URL;

  constructor(
    readonly code: SetupScanErrorCode,
    readonly blockedReason?: string,
  ) {
    super(code);
  }
}

/** Node/OpenSSL codes for a certificate that fails verification (expired, self-signed, wrong host, ...). */
const TLS_CERT_ERROR =
  /^(CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT|UNABLE_TO_(VERIFY_LEAF_SIGNATURE|GET_ISSUER_CERT)|ERR_TLS_CERT_ALTNAME_INVALID)/;

function classify(error: unknown): ScanFailure {
  const message = error instanceof Error ? error.message : '';
  const tlsCode = (error as { code?: unknown } | null)?.code;
  if (typeof tlsCode === 'string' && TLS_CERT_ERROR.test(tlsCode)) {
    return new ScanFailure('ssl_invalid');
  }
  if (message.includes(BLOCKED_MESSAGE)) {
    return new ScanFailure('blocked_private', 'private_or_reserved_address');
  }
  if (error instanceof MonitorRedirectError) {
    return new ScanFailure(
      /redirect limit/.test(message) ? 'too_many_redirects' : 'unreachable',
    );
  }
  const code = error instanceof AxiosError ? error.code : undefined;
  if (
    code === 'ECONNABORTED' ||
    code === 'ERR_CANCELED' ||
    isTimeoutError(error)
  ) {
    return new ScanFailure('timeout');
  }
  return new ScanFailure('unreachable');
}

async function fetchPage(
  url: URL,
  deps: SetupScanDeps,
  budget: AbortSignal,
): Promise<FetchedPage> {
  let hops = 0;
  let lastUrl = url;
  const started = Date.now();
  const config: AxiosRequestConfig<unknown> = {
    url: url.toString(),
    method: 'GET',
    // The pinned helper replaces `signal` when `timeout` is set, so the 10 s per-request limit
    // and the shared scan budget are combined here instead.
    signal: AbortSignal.any([
      AbortSignal.timeout(SCAN_LIMITS.requestTimeoutMs),
      budget,
    ]),
    responseType: 'text',
    maxContentLength: SCAN_LIMITS.maxBodyBytes,
    maxBodyLength: SCAN_LIMITS.maxBodyBytes,
    validateStatus: () => true,
    headers: {
      'User-Agent': 'Supercheck-Setup-Scan/1.0',
      Accept: 'text/html,*/*;q=0.8',
    },
  };

  let response: AxiosResponse<unknown> | undefined;
  let status: number;
  let overLimit = false;
  try {
    response = await requestPinnedMonitorTarget(
      config,
      {
        allowInternalTargets: deps.allowInternalTargets(),
        maxRedirects: SCAN_LIMITS.maxRedirects,
      },
      (validated) => {
        hops += 1;
        lastUrl = new URL(String(validated.url));
        return deps.execute(validated);
      },
    );
    status = response.status;
  } catch (error) {
    const sawStatus =
      error instanceof AxiosError &&
      error.code === AxiosError.ERR_BAD_RESPONSE &&
      /maxContentLength/.test(error.message)
        ? (error.request as { res?: { statusCode?: number } } | undefined)?.res
            ?.statusCode
        : undefined;
    if (!sawStatus) {
      const failure = classify(error);
      failure.url = lastUrl;
      throw failure;
    }
    // Body over the cap: the server answered, we just do not read the page.
    status = sawStatus;
    overLimit = true;
  }

  const html =
    !overLimit && typeof response?.data === 'string' ? response.data : '';
  const headers = response?.headers ?? {};
  const botProtected =
    [403, 429, 503].includes(status) &&
    (Boolean(headers['cf-mitigated']) ||
      /cloudflare/i.test(String(headers['server'] ?? '')) ||
      BOT_MARKERS.test(html.slice(0, 20_000)));
  return {
    status,
    ms: Date.now() - started,
    finalUrl: lastUrl,
    redirects: Math.max(0, hops - 1),
    html,
    botProtected,
  };
}

async function readSsl(
  url: URL,
  deps: SetupScanDeps,
  budget: AbortSignal,
): Promise<SetupScanResult['ssl']> {
  // An already-aborted budget never fires its listener, so skip the read outright.
  if (url.protocol !== 'https:' || budget.aborted) return null;
  try {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const read = (async () => {
      const lookup = await vettedLookup(hostname, deps.allowInternalTargets());
      return deps.readCertificate({
        hostname,
        port: Number(url.port) || 443,
        lookup,
        timeoutMs: SCAN_LIMITS.requestTimeoutMs,
      });
    })();
    const info = await Promise.race([
      read,
      new Promise<never>((_resolve, reject) =>
        budget.addEventListener('abort', () => reject(new Error('budget')), {
          once: true,
        }),
      ),
    ]);
    const validTo = new Date(info.certificate?.valid_to);
    if (Number.isNaN(validTo.getTime())) return null;
    return {
      validTo: validTo.toISOString(),
      daysRemaining: Math.ceil((validTo.getTime() - Date.now()) / 86_400_000),
      issuer: String(info.certificate.issuer?.CN ?? 'Unknown').slice(0, 120),
    };
  } catch {
    return null;
  }
}

/**
 * Scan one customer-supplied URL: homepage, a few same-origin pages and the TLS certificate.
 * Returns status codes, timings, titles and paths only, never bodies or headers.
 * Internal-target policy comes from the worker's own environment, not from the job payload.
 */
export async function processSetupScan(
  data: unknown,
  overrides: Partial<SetupScanDeps> = {},
): Promise<SetupScanResult> {
  const deps = { ...defaultDeps, ...overrides };
  const raw = (data as { url?: unknown } | null)?.url;
  let start: URL;
  try {
    start = new URL(String(raw));
    if (start.protocol !== 'http:' && start.protocol !== 'https:')
      throw new Error();
  } catch {
    return emptyResult('', 'unreachable');
  }
  const budget = AbortSignal.timeout(SCAN_LIMITS.totalBudgetMs);
  const startOrigin = originAndPath(start);

  let home: FetchedPage;
  try {
    home = await fetchPage(start, deps, budget);
  } catch (error) {
    const failure = error instanceof ScanFailure ? error : classify(error);
    return {
      ...emptyResult(startOrigin, failure.code),
      // The request refused the certificate; the unverified read still reports its expiry date.
      ssl:
        failure.code === 'ssl_invalid'
          ? await readSsl(failure.url ?? start, deps, budget)
          : null,
      blockedReason: failure.blockedReason,
    };
  }

  // Read the certificate before crawling so a slow crawl cannot use up its time budget.
  const ssl = await readSsl(home.finalUrl, deps, budget);
  const pages: SetupScanResult['pages'] = [
    {
      path: home.finalUrl.pathname,
      status: home.status,
      ms: home.ms,
      title: extractTitle(home.html),
    },
  ];
  const queue = extractLinks(home.html, home.finalUrl);
  const crawl = async () => {
    while (!budget.aborted && pages.length < SCAN_LIMITS.maxPages) {
      const path = queue.shift();
      if (path === undefined) return;
      const target = new URL(path, home.finalUrl);
      if (target.origin !== home.finalUrl.origin) continue;
      // Slot is claimed before the request so concurrent workers cannot exceed the cap.
      const slot = pages.push({ path, status: 0, ms: 0, title: null }) - 1;
      try {
        const page = await fetchPage(target, deps, budget);
        pages[slot] = {
          path,
          status: page.status,
          ms: page.ms,
          title: extractTitle(page.html),
          ...(page.finalUrl.origin !== target.origin ||
          page.finalUrl.pathname.replace(/\/$/, '') !==
            target.pathname.replace(/\/$/, '')
            ? { redirected: true, finalPath: page.finalUrl.pathname }
            : {}),
        };
      } catch {
        // A page that fails keeps status 0; the homepage result decides the scan outcome.
      }
    }
  };
  await Promise.all(
    Array.from({ length: SCAN_LIMITS.pageConcurrency }, () => crawl()),
  );

  const result: SetupScanResult = {
    finalUrl: originAndPath(home.finalUrl),
    reachable: true,
    status: home.status,
    redirects: home.redirects,
    responseMs: home.ms,
    ssl,
    pages,
  };
  if (home.botProtected) result.error = 'bot_protection';
  return result;
}

function emptyResult(
  finalUrl: string,
  error: SetupScanErrorCode,
): SetupScanResult {
  return {
    finalUrl,
    reachable: false,
    status: null,
    redirects: 0,
    responseMs: null,
    ssl: null,
    pages: [],
    error,
  };
}
