import { expect, test } from '@playwright/test';
import {
  isSameInstance,
  replaceConfig,
  type SupercheckConfig,
} from '../../examples/recorder-crx/src/supercheck/config';
import { apiClient } from '../../examples/recorder-crx/src/supercheck/api-client';

type FetchImpl = typeof fetch;

async function withStorage(
  initial: SupercheckConfig,
  run: (state: { written: () => SupercheckConfig | undefined }) => Promise<void>,
) {
  const originalChrome = globalThis.chrome;
  let written: SupercheckConfig | undefined;
  apiClient.clearCache();
  try {
    globalThis.chrome = { storage: { sync: {
      get: async () => ({ supercheckConfig: initial }),
      set: async (values: Record<string, unknown>) => {
        written = values.supercheckConfig as SupercheckConfig;
      },
    } } } as unknown as typeof chrome;
    await run({ written: () => written });
  } finally {
    globalThis.chrome = originalChrome;
  }
}

async function withFetch(fetchImpl: FetchImpl, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = fetchImpl;
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    apiClient.clearCache();
  }
}

test('compares instance URLs by origin', () => {
  expect(isSameInstance('https://app.supercheck.io', 'https://app.supercheck.io/')).toBe(true);
  expect(isSameInstance('https://app.supercheck.io/dashboard', 'https://app.supercheck.io')).toBe(true);
  expect(isSameInstance('https://app.supercheck.io', 'https://demo.supercheck.dev')).toBe(false);
  expect(isSameInstance('http://localhost:3000', 'https://localhost:3000')).toBe(false);
  expect(isSameInstance(undefined, 'https://app.supercheck.io')).toBe(false);
});

test('replacing the instance drops the previous credential', async () => {
  await withStorage(
    { instanceUrl: 'https://old.example.test', apiKey: 'ext-old', userEmail: 'old@example.test', autoConnected: true },
    async ({ written }) => {
      await replaceConfig({ instanceUrl: 'https://new.example.test', autoConnected: false });
      expect(written()).toEqual({ instanceUrl: 'https://new.example.test', autoConnected: false });
      expect(written()).not.toHaveProperty('apiKey');
      expect(written()).not.toHaveProperty('userEmail');
    },
  );
});

test('verifies the recorder credential through the extension endpoint', async () => {
  await withStorage(
    { instanceUrl: 'https://app.supercheck.io', apiKey: 'ext-test' },
    async () => {
      await withFetch(
        (async (url, init) => {
          expect(url).toBe('https://app.supercheck.io/api/extension/projects');
          expect(init?.headers).toEqual({ 'x-api-key': 'ext-test' });
          return new Response(JSON.stringify({ success: true, data: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }) as FetchImpl,
        async () => {
          await expect(apiClient.verifyConnection()).resolves.toEqual({ valid: true });
        },
      );
    },
  );
});

test('reports an invalid key without throwing', async () => {
  await withStorage(
    { instanceUrl: 'https://demo.supercheck.dev', apiKey: 'ext-stale' },
    async () => {
      await withFetch(
        (async () => new Response(JSON.stringify({ success: false }), { status: 401 })) as FetchImpl,
        async () => {
          await expect(apiClient.verifyConnection()).resolves.toEqual({ valid: false, reason: 'invalid' });
        },
      );
    },
  );
});

test('reports an unreachable instance without throwing', async () => {
  await withStorage(
    { instanceUrl: 'https://self-hosted.example.test', apiKey: 'ext-test' },
    async () => {
      await withFetch(
        (async () => { throw new TypeError('fetch failed'); }) as FetchImpl,
        async () => {
          const result = await apiClient.verifyConnection();
          expect(result.valid).toBe(false);
          expect(result.reason).toBe('unreachable');
        },
      );
    },
  );
});

test('falls back to verify-key for older self-hosted deployments', async () => {
  await withStorage(
    { instanceUrl: 'https://self-hosted.example.test', apiKey: 'ext-test' },
    async () => {
      const calls: string[] = [];
      await withFetch(
        (async (url) => {
          calls.push(String(url));
          if (calls.length === 1)
            return new Response(null, { status: 404 });
          return new Response(JSON.stringify({ valid: true }), { status: 200 });
        }) as FetchImpl,
        async () => {
          await expect(apiClient.verifyConnection()).resolves.toEqual({ valid: true });
          expect(calls).toEqual([
            'https://self-hosted.example.test/api/extension/projects',
            'https://self-hosted.example.test/api/auth/verify-key',
          ]);
        },
      );
    },
  );
});

test('separates rate limiting from an invalid key', async () => {
  await withStorage(
    { instanceUrl: 'https://self-hosted.example.test', apiKey: 'ext-test' },
    async () => {
      const calls: string[] = [];
      await withFetch(
        (async (url) => {
          calls.push(String(url));
          if (calls.length === 1)
            return new Response(null, { status: 404 });
          return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
            status: 429,
            headers: { 'retry-after': '30' },
          });
        }) as FetchImpl,
        async () => {
          const result = await apiClient.verifyConnection();
          expect(result.valid).toBe(false);
          expect(result.reason).toBe('rate_limited');
          expect(result.retryAfterSeconds).toBe(30);
        },
      );
    },
  );
});

test('does not treat a 200 without the success marker as a valid credential', async () => {
  await withStorage(
    { instanceUrl: 'https://self.example.com', apiKey: 'ext-test' },
    async () => {
      await withFetch(
        (async () => new Response('<html>ok</html>', { status: 200 })) as FetchImpl,
        async () => {
          await expect(apiClient.verifyConnection()).resolves.toEqual({
            valid: false,
            reason: 'server_error',
          });
        },
      );
    },
  );
});
