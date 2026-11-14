import { Logger } from '@nestjs/common';
import {
  WEBHOOK_RETRY_CONFIG,
  calculateDelay,
  createRetryConfig,
  executeWithRetry,
  fetchWithRetry,
  isRetryableError,
  isRetryableStatusCode,
  MAX_RETRY_AFTER_MS,
  retryAfterDelayMs,
  type RetryOptions,
} from './retry.util';
import { STALE_PENDING_CLAIM_SECONDS } from '../../monitor/services/monitor-alert.service';

function makeResponse(
  status: number,
  body = 'body',
  retryAfter?: string,
): {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null,
    },
    text: async () => body,
  };
}

const FAST_RETRY: RetryOptions = {
  maxRetries: 2,
  initialDelayMs: 1,
  maxDelayMs: 10,
  backoffMultiplier: 2,
  timeoutMs: 1000,
  jitterFactor: 0,
};

describe('retry.util', () => {
  const originalFetch = global.fetch;
  const envKeys = [
    'NOTIFICATION_MAX_RETRIES',
    'NOTIFICATION_INITIAL_DELAY_MS',
    'NOTIFICATION_TIMEOUT_MS',
  ];
  const originalEnv = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );

  beforeEach(() => {
    for (const key of envKeys) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  describe('isRetryableStatusCode', () => {
    it.each([429, 500, 502, 503, 504])('retries status %s', (status) => {
      expect(isRetryableStatusCode(status)).toBe(true);
    });

    it.each([200, 201, 301, 400, 401, 403, 404, 422])(
      'does not retry status %s',
      (status) => {
        expect(isRetryableStatusCode(status)).toBe(false);
      },
    );
  });

  describe('isRetryableError', () => {
    it.each([
      'connect ETIMEDOUT',
      'connect ECONNREFUSED 127.0.0.1:80',
      'socket hang up',
      'read ECONNRESET',
      'getaddrinfo ENOTFOUND example.com',
      'network error',
      'fetch failed',
      'request timeout',
    ])('retries network error "%s"', (message) => {
      expect(isRetryableError(new Error(message))).toBe(true);
    });

    it('retries AbortError by error name', () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';

      expect(isRetryableError(error)).toBe(true);
    });

    it.each(['invalid input', 'unauthorized', 'not found'])(
      'does not retry non-network error "%s"',
      (message) => {
        expect(isRetryableError(new Error(message))).toBe(false);
      },
    );

    it('does not retry non-Error values', () => {
      expect(isRetryableError('ECONNRESET')).toBe(false);
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
    });
  });

  describe('calculateDelay', () => {
    const options: RetryOptions = {
      maxRetries: 5,
      initialDelayMs: 100,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      timeoutMs: 1000,
      jitterFactor: 0,
    };

    it('grows exponentially from the initial delay', () => {
      expect(calculateDelay(0, options)).toBe(100);
      expect(calculateDelay(1, options)).toBe(200);
      expect(calculateDelay(3, options)).toBe(800);
    });

    it('caps the delay at maxDelayMs', () => {
      expect(calculateDelay(20, options)).toBe(30000);
    });

    it('keeps jitter within +/- the jitter factor', () => {
      const jittered: RetryOptions = { ...options, jitterFactor: 0.1 };

      for (let i = 0; i < 50; i++) {
        const delay = calculateDelay(1, jittered);
        expect(delay).toBeGreaterThanOrEqual(180);
        expect(delay).toBeLessThanOrEqual(220);
      }
    });

    it('never returns a negative delay', () => {
      const wild: RetryOptions = {
        ...options,
        initialDelayMs: 1,
        jitterFactor: 1,
      };

      for (let i = 0; i < 50; i++) {
        expect(calculateDelay(0, wild)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('createRetryConfig', () => {
    it('returns the webhook defaults', () => {
      expect(createRetryConfig()).toEqual(WEBHOOK_RETRY_CONFIG);
    });

    it('never lets one attempt outlast the total budget', () => {
      expect(createRetryConfig({ timeoutMs: 200_000 }).timeoutMs).toBe(
        WEBHOOK_RETRY_CONFIG.maxTotalMs,
      );
      const previous = process.env.NOTIFICATION_TIMEOUT_MS;
      process.env.NOTIFICATION_TIMEOUT_MS = '150000';
      try {
        expect(createRetryConfig().timeoutMs).toBe(90_000);
      } finally {
        if (previous === undefined) delete process.env.NOTIFICATION_TIMEOUT_MS;
        else process.env.NOTIFICATION_TIMEOUT_MS = previous;
      }
    });

    it('applies explicit overrides', () => {
      const config = createRetryConfig({ maxRetries: 9, initialDelayMs: 5 });

      expect(config.maxRetries).toBe(9);
      expect(config.initialDelayMs).toBe(5);
      expect(config.timeoutMs).toBe(WEBHOOK_RETRY_CONFIG.timeoutMs);
    });

    it('reads environment overrides', () => {
      process.env.NOTIFICATION_MAX_RETRIES = '7';
      process.env.NOTIFICATION_INITIAL_DELAY_MS = '250';
      process.env.NOTIFICATION_TIMEOUT_MS = '5000';

      const config = createRetryConfig();

      expect(config.maxRetries).toBe(7);
      expect(config.initialDelayMs).toBe(250);
      expect(config.timeoutMs).toBe(5000);
    });

    it('prefers explicit overrides over environment values', () => {
      process.env.NOTIFICATION_MAX_RETRIES = '7';

      expect(createRetryConfig({ maxRetries: 1 }).maxRetries).toBe(1);
    });
  });

  describe('executeWithRetry', () => {
    it('returns the result on first success', async () => {
      const fn = jest.fn().mockResolvedValue('ok');

      await expect(executeWithRetry(fn, FAST_RETRY)).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries retryable failures and then succeeds', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValue('recovered');

      await expect(executeWithRetry(fn, FAST_RETRY)).resolves.toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws immediately on non-retryable errors', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('invalid input'));

      await expect(executeWithRetry(fn, FAST_RETRY)).rejects.toThrow(
        'invalid input',
      );
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws the last error after exhausting retries', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('connect ECONNRESET'));

      await expect(executeWithRetry(fn, FAST_RETRY)).rejects.toThrow(
        'connect ECONNRESET',
      );
      expect(fn).toHaveBeenCalledTimes(FAST_RETRY.maxRetries + 1);
    });

    it('wraps non-Error rejections', async () => {
      const fn = jest.fn().mockRejectedValue('plain failure');

      await expect(executeWithRetry(fn, FAST_RETRY)).rejects.toThrow(
        'plain failure',
      );
    });

    it('enforces the timeout when timeoutMs is set', async () => {
      const fn = jest.fn(() => new Promise<never>(() => {}));

      await expect(
        executeWithRetry(fn, { ...FAST_RETRY, timeoutMs: 10 }),
      ).rejects.toThrow('Operation timed out after 10ms');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('clears the timeout timer once the call settles', async () => {
      jest.useFakeTimers();
      try {
        await expect(
          executeWithRetry(jest.fn().mockResolvedValue('ok'), {
            ...FAST_RETRY,
            timeoutMs: 60_000,
          }),
        ).resolves.toBe('ok');
        await expect(
          executeWithRetry(
            jest.fn().mockRejectedValue(new Error('bad request')),
            {
              ...FAST_RETRY,
              timeoutMs: 60_000,
            },
          ),
        ).rejects.toThrow('bad request');
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it('skips the timeout race when timeoutMs is zero', async () => {
      const fn = jest.fn().mockResolvedValue('ok');

      await expect(
        executeWithRetry(fn, { ...FAST_RETRY, timeoutMs: 0 }),
      ).resolves.toBe('ok');
    });

    it('logs a warning for non-retryable errors', async () => {
      const logger = { warn: jest.fn(), debug: jest.fn() } as unknown as Logger;
      const fn = jest.fn().mockRejectedValue(new Error('bad request'));

      await expect(executeWithRetry(fn, FAST_RETRY, logger)).rejects.toThrow(
        'bad request',
      );
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('fetchWithRetry', () => {
    it('returns immediately on a successful response', async () => {
      const response = makeResponse(200);
      global.fetch = jest.fn().mockResolvedValue(response);

      const result = await fetchWithRetry(
        'https://example.com',
        {},
        FAST_RETRY,
      );

      expect(result).toEqual({
        success: true,
        data: response,
        attempts: 1,
        lastStatusCode: 200,
        lastResponseBody: 'body',
        attemptLog: [{ n: 1, status: 200, ms: expect.any(Number) }],
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry non-retryable HTTP errors', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(makeResponse(404, 'not found'));

      const result = await fetchWithRetry(
        'https://example.com',
        {},
        FAST_RETRY,
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(result.lastStatusCode).toBe(404);
      expect(result.error).toContain('HTTP 404');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('retries 5xx responses and succeeds', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(makeResponse(500, 'boom'))
        .mockResolvedValueOnce(makeResponse(200));

      const result = await fetchWithRetry(
        'https://example.com',
        {},
        FAST_RETRY,
      );

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('retries 429 rate limits', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(makeResponse(429, 'slow down'))
        .mockResolvedValueOnce(makeResponse(200));

      const result = await fetchWithRetry(
        'https://example.com',
        {},
        FAST_RETRY,
      );

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('reports exhaustion after all retryable attempts fail', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(makeResponse(503, 'unavailable'));

      const result = await fetchWithRetry(
        'https://example.com',
        {},
        FAST_RETRY,
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(FAST_RETRY.maxRetries + 1);
      expect(result.lastStatusCode).toBe(503);
      expect(result.error).toContain('Failed after 3 attempts');
      expect(global.fetch).toHaveBeenCalledTimes(FAST_RETRY.maxRetries + 1);
    });

    it('retries retryable network errors', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce(makeResponse(200));

      const result = await fetchWithRetry(
        'https://example.com',
        {},
        FAST_RETRY,
      );

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('does not retry non-retryable network errors', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('invalid URL'));

      const result = await fetchWithRetry(
        'https://example.com',
        {},
        FAST_RETRY,
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(result.error).toBe('invalid URL');
    });

    it('passes an abort signal to fetch', async () => {
      global.fetch = jest.fn().mockResolvedValue(makeResponse(200));

      await fetchWithRetry(
        'https://example.com',
        { method: 'POST' },
        FAST_RETRY,
      );

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('paging retry rules', () => {
    afterEach(() => jest.useRealTimers());

    it('parses Retry-After seconds and HTTP dates, capped at 10 s', () => {
      expect(retryAfterDelayMs('3')).toBe(3000);
      expect(retryAfterDelayMs('120')).toBe(MAX_RETRY_AFTER_MS);
      const now = Date.parse('2026-11-14T10:00:00Z');
      expect(retryAfterDelayMs('Sat, 14 Nov 2026 10:00:04 GMT', now)).toBe(
        4000,
      );
      expect(retryAfterDelayMs('Sat, 14 Nov 2026 09:00:00 GMT', now)).toBe(0);
      expect(retryAfterDelayMs('soon')).toBeUndefined();
      expect(retryAfterDelayMs(null)).toBeUndefined();
    });

    it('waits for Retry-After on 429 and 503 instead of the backoff', async () => {
      jest.useFakeTimers();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(makeResponse(429, 'slow down', '5'))
        .mockResolvedValueOnce(makeResponse(503, 'busy', '120'))
        .mockResolvedValueOnce(makeResponse(200));
      const pending = fetchWithRetry(
        'https://example.com',
        {},
        {
          ...FAST_RETRY,
          maxTotalMs: 60_000,
        },
      );
      await jest.advanceTimersByTimeAsync(4_999);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      // 120 s asked, 10 s honoured.
      await jest.advanceTimersByTimeAsync(MAX_RETRY_AFTER_MS);
      const result = await pending;
      expect(result.success).toBe(true);
      expect(result.attemptLog?.map((a) => a.status)).toEqual([429, 503, 200]);
    });

    it.each([400, 401, 403, 404])('never retries HTTP %s', async (status) => {
      global.fetch = jest.fn().mockResolvedValue(makeResponse(status, 'no'));
      const result = await fetchWithRetry(
        'https://example.com',
        {},
        FAST_RETRY,
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        success: false,
        lastStatusCode: status,
        lastResponseBody: 'no',
      });
    });

    it('stops retrying once the total budget would be exceeded', async () => {
      global.fetch = jest.fn().mockResolvedValue(makeResponse(500, 'down'));
      const result = await fetchWithRetry(
        'https://example.com',
        {},
        {
          ...FAST_RETRY,
          maxRetries: 5,
          timeoutMs: 1000,
          maxTotalMs: 500,
        },
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(result.error).toContain('retry budget spent');
      expect(result.attemptLog).toHaveLength(1);
    });

    it('logs network errors per attempt', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce(makeResponse(200));
      const result = await fetchWithRetry(
        'https://example.com',
        {},
        FAST_RETRY,
      );
      expect(result.attemptLog).toEqual([
        { n: 1, error: 'ECONNRESET', ms: expect.any(Number) },
        { n: 2, status: 200, ms: expect.any(Number) },
      ]);
    });

    it('keeps the worst-case webhook send under the stale-claim window', () => {
      const budget = WEBHOOK_RETRY_CONFIG.maxTotalMs ?? Infinity;
      // No retry starts unless wait + timeout fits the budget, so the budget bounds the whole send.
      expect(budget).toBeLessThan(STALE_PENDING_CLAIM_SECONDS * 1000);
      expect(WEBHOOK_RETRY_CONFIG.timeoutMs).toBeLessThanOrEqual(10_000);
    });
  });
});
